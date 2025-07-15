import torch
from torch import nn
from typing import Tuple

# Taken from facebookresearch/llama/model.py
def reshape_for_broadcast(freqs_cis: torch.Tensor, x: torch.Tensor):
    ndim = x.ndim
    assert 0 <= 1 < ndim
    assert freqs_cis.shape == (x.shape[1], x.shape[-1])
    shape = [d if i == 1 or i == ndim - 1 else 1 for i, d in enumerate(x.shape)]
    return freqs_cis.view(*shape)


# Taken from facebookresearch/llama/model.py
def apply_rotary_emb(
    xq: torch.Tensor,
    xk: torch.Tensor,
    freqs_cis: torch.Tensor,
) -> Tuple[torch.Tensor, torch.Tensor]:
    xq_ = torch.view_as_complex(xq.float().reshape(*xq.shape[:-1], -1, 2))
    xk_ = torch.view_as_complex(xk.float().reshape(*xk.shape[:-1], -1, 2))
    freqs_cis = reshape_for_broadcast(freqs_cis, xq_)
    xq_out = torch.view_as_real(xq_ * freqs_cis).flatten(3)
    xk_out = torch.view_as_real(xk_ * freqs_cis).flatten(3)

    return xq_out.type_as(xq), xk_out.type_as(xk)

# Taken from facebookresearch/llama/model.py
def precompute_freqs_cis(dim: int, end: int, theta: float = 10000.0):
    freqs = 1.0 / (
        theta ** (torch.arange(0, dim, 2)[: (dim // 2)].float() / dim)
    )
    t = torch.arange(end, device=freqs.device)  # type: ignore
    freqs = torch.outer(t, freqs).float()  # type: ignore
    freqs_cis = torch.polar(torch.ones_like(freqs), freqs)  # complex64

    return freqs_cis


class FusedEncoderBlock(nn.Module):
    """Transformer encoder block using F.scaled_dot_product_attention().

    This block has the following changes from a typical transformer encoder:

        - Rotary embeddings are applied to the key/query matrices.
        - Layer norm is applied before attention and feed forward, instead of
            after.
        - Keys arising from padding are masked during attention.
        - GELU activation is used instead of ReLU.

    Args:
        model_config (ModelConfig): Model config settings.
    """

    def __init__(self, model_config: ModelConfig):
        super().__init__()

        self.pad_id = model_config.pad_id
        self.drop_p = model_config.drop_p
        self.n_heads = model_config.n_heads
        self.d_head = model_config.d_model // model_config.n_heads
        self.max_seq_len = model_config.max_seq_len

        # Attention
        self.q = nn.Linear(
            in_features=model_config.d_model,
            out_features=model_config.d_model,
            bias=False,
        )
        self.k = nn.Linear(
            in_features=model_config.d_model,
            out_features=model_config.d_model,
            bias=False,
        )
        self.v = nn.Linear(
            in_features=model_config.d_model,
            out_features=model_config.d_model,
            bias=False,
        )
        self.att_proj_linear = nn.Linear(
            in_features=model_config.d_model,
            out_features=model_config.d_model,
        )
        self.resid_dropout = nn.Dropout(model_config.drop_p)

        # FF Layer
        self.ff_dropout = nn.Dropout(model_config.drop_p)
        self.ff_linear_1 = nn.Linear(
            in_features=model_config.d_model,
            out_features=model_config.d_model * model_config.ff_mult,
        )
        self.ff_linear_2 = nn.Linear(
            in_features=model_config.d_model * model_config.ff_mult,
            out_features=model_config.d_model,
        )
        self.ff_activation = nn.GELU()

        # Pre layer norms
        self.norm1 = nn.LayerNorm(model_config.d_model)
        self.norm2 = nn.LayerNorm(model_config.d_model)

    def forward(
        self, x: torch.Tensor, pad_mask: torch.Tensor, freqs_cis: torch.Tensor
    ):
        x = x + self._att_block(self.norm1(x), pad_mask, freqs_cis)
        x = x + self._ff_block(self.norm2(x))

        return x

    def _att_block(
        self, x: torch.Tensor, pad_mask: torch.Tensor, freqs_cis: torch.Tensor
    ):
        batch_size, seq_len, _ = x.shape
        xq, xk, xv = self.q(x), self.k(x), self.v(x)

        # Reshape for rotary embeddings
        xq = xq.view(batch_size, seq_len, self.n_heads, self.d_head)
        xk = xk.view(batch_size, seq_len, self.n_heads, self.d_head)
        xv = xv.view(batch_size, seq_len, self.n_heads, self.d_head)
        xq, xk = apply_rotary_emb(xq, xk, freqs_cis)

        # Reshape for attention calculation: (b_sz, n_head, s_len, d_head)
        xq = xq.transpose(1, 2)
        xk = xk.transpose(1, 2)
        xv = xv.transpose(1, 2)

        # Required as we are not using a nn.Dropout layer
        if self.training:
            att_dropout = self.drop_p
        else:
            att_dropout = 0.0

        # Using beta torch functionality (subject to change)
        # See - https://shorturl.at/jtI17
        att = F.scaled_dot_product_attention(
            query=xq,
            key=xk,
            value=xv,
            attn_mask=pad_mask,
            dropout_p=att_dropout,
            is_causal=False,
        )

        # Shape (b_sz, s_len, n_head, d_head)
        out = att.transpose(1, 2).contiguous()
        out = out.view(batch_size, seq_len, self.n_heads * self.d_head)

        return self.resid_dropout(self.att_proj_linear(out))

    def _ff_block(self, x: torch.Tensor):
        x = self.ff_linear_2(self.ff_activation(self.ff_linear_1(x)))

        return self.ff_dropout(x)
