import torch.nn as nn
import torch

class DecoderOnlyTransformerLayer(nn.Module):
    def __init__(self, d_model, num_heads, dim_feedforward, dropout_rate=0.1):
        super().__init__()
        self.self_attn = nn.MultiheadAttention(d_model, num_heads, dropout=dropout_rate, batch_first=False)
        self.norm1 = nn.LayerNorm(d_model)
        self.dropout1 = nn.Dropout(dropout_rate)

        self.linear1 = nn.Linear(d_model, dim_feedforward)
        self.relu = nn.ReLU() # Or GELU
        self.dropout_ff = nn.Dropout(dropout_rate)
        self.linear2 = nn.Linear(dim_feedforward, d_model)
        self.norm2 = nn.RMSNorm(d_model)
        self.dropout2 = nn.Dropout(dropout_rate)

    def forward(self, tgt, tgt_mask=None):
        # Masked Multi-Head Self-Attention
        # q, k, v are all the target sequence itself
        attn_output, _ = self.self_attn(tgt, tgt, tgt, attn_mask=tgt_mask, is_causal=True)
        # Add & Norm
        tgt = tgt + self.dropout1(attn_output)
       # tgt = self.norm1(tgt)

        # Feed-Forward Network
        ff_output = self.linear2(self.relu(self.linear1(tgt)))
        # Add & Norm
        tgt = tgt + self.dropout2(ff_output)
        #tgt = self.norm2(tgt)
        return tgt

# define a decoder only transformer model
class TransformerDecoder(torch.nn.Module):
    def __init__(self, d_model=64, nhead=4, num_layers=2, dropout_rate=0.1, maxval=250, logscale_tricks=True, max_time_dim=216):
        super(TransformerDecoder, self).__init__()
        
        self.positional_encoding = nn.Embedding(max_time_dim, d_model)
        # initialize positional encoding with sinusoidal values
        position = torch.arange(0, max_time_dim, dtype=torch.long).unsqueeze(1)  # (seq_len, 1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * -(torch.log(torch.tensor(512.0)) / d_model))
        pe = torch.zeros(max_time_dim, d_model)
        pe[:, 0::2] = torch.sin(position * div_term)  # even indices
        pe[:, 1::2] = torch.cos(position * div_term)  # odd indices
        self.positional_encoding.weight = nn.Parameter(pe, requires_grad=True)

        decoder_layers = []
        for _ in range(num_layers):
            decoder_layers.append(
                DecoderOnlyTransformerLayer(d_model, nhead, d_model * 4, dropout_rate)
            )
        self.decoder_blocks = torch.nn.ModuleList(decoder_layers) # Use ModuleList to hold layers

        self.input_linear = torch.nn.Linear(1, d_model)
        self.input_linear2 = torch.nn.Linear(d_model, d_model)  # Optional second linear layer
        self.linear = torch.nn.Linear(d_model, 1)
        self.maxval = maxval
        self.logscale_tricks = logscale_tricks

    def generate_square_subsequent_mask(self, sz):
        return (torch.triu(torch.ones(sz, sz), diagonal=1) == 1)
        #mask = (torch.triu(torch.ones(sz, sz)) == 1).transpose(0, 1)
        # `bool` mask for MultiheadAttention where False means mask
        # For TransformerDecoderLayer it's float with -inf, but MultiheadAttention takes bool
        # Or you can keep float with -inf for MHA, it generally handles it.
        # Let's stick to float('-inf') for consistency if using the mask_fill pattern
        #mask = mask.float().masked_fill(mask == 0, float('-inf')).masked_fill(mask == 1, float(0.0))
        #return mask


    def forward(self, x: torch.Tensor):
        #print("Input shape:", x.shape)
        # x is of shape (batch_size, seq_length): value
        # x: (batch_size, seq_length)
        x = x.unsqueeze(-1) # (batch_size, seq_length, 1)
        x = x.permute(1, 0, 2)  # (seq_length, batch_size, 1)

        if self.training and False:
            # some random noise multiplier to the input
            noise_multiplier = torch.rand_like(x) * 0.04 + 0.98  # between 0.95 and 1.05
            x = x * noise_multiplier  # (seq_length, batch_size, 1)
            noise_additive = torch.randn_like(x) * 0.05  # small noise
            x = x + noise_additive
            x = torch.clamp(x, 0, self.maxval)  # ensure values are between 0 and 250
        else:
            # during inference we just use the input as is
            pass

        # now we need to transform the value x (which is between 0 and 250) to a d_model dimension
        if self.logscale_tricks:
            x = torch.log1p(x) / torch.log(torch.tensor(self.maxval + 1))
        else:
            x = x / self.maxval
        #x = x / 100.0 - 1  # normalize to roughly [0, 1]
        x = self.input_linear(x)  # (seq_length, batch_size, d_model)
        x = torch.relu(x)  # Apply ReLU activation
        x = self.input_linear2(x)
        seq_len, batch_size, _ = x.size()
        #print("Input shape2:", x.shape)
        tgt_mask = self.generate_square_subsequent_mask(seq_len).to(x.device)
        pos = torch.arange(0, seq_len, dtype=torch.long, device=x.device)
        x = x + self.positional_encoding(pos).unsqueeze(1)  # (seq_length, batch_size, d_model)

        for decoder_block in self.decoder_blocks:
            x = decoder_block(x, tgt_mask=tgt_mask)

        x = self.linear(x)  # (seq_length, batch_size, 1)
        if self.logscale_tricks:
            x = torch.expm1(x * torch.log(torch.tensor(self.maxval + 1)))  # scale back to original value range
        else:
            x = x * self.maxval
        #x = (self.linear(x) + 1) * 100.0  # scale back to original value range
        return x