import pandas as pd
import os
import torch
import datetime
from torch.utils.data import DataLoader

import random
from torch.optim.swa_utils import AveragedModel, SWALR

from .data import dataset, validation_dataset
from .model import TransformerDecoder

#model_state_dict = torch.load(os.path.join(os.path.dirname(__file__), 'models/model_epoch_100.pt'))
#model = TransformerDecoder(d_model=32, nhead=1, num_layers=2)
# model = AveragedModel(model)  # Wrap the model in AveragedModel
#model.load_state_dict(model_state_dict)
model: TransformerDecoder = torch.load(os.path.join(os.path.dirname(__file__), 'models/model_epoch_190.ptp'), weights_only=False)


for i in range(1, len(dataset)):
    data = validation_dataset[i]
    data = data.unsqueeze(0)  # Add batch dimension
    #data = data.unsqueeze(1)  # Add feature dimension
    #print("Input shape:", data.shape)

    # make it smaller to make it harder


    # greedy decoding
    model.train()
    with torch.no_grad():
        beams = []
        for start_point in [50, 75, 100, 125, 150, 175]:
            cur_beam = data[:, :start_point].clone()  # Take the first 100 time steps
            ind = start_point
            while cur_beam.shape[1] < 215:
                #print("input:", data.shape)
                output = model(cur_beam)  # (seq_length, batch_size, 1)
                output = output.permute(1, 0, 2)
                #print("Output shape:", output.tolist())
                #print("Output shape:", output.shape)
                cur_beam = torch.cat((cur_beam, output[:, -1, :]), dim=1)
                ind += 1
            beams.append(cur_beam)
    #print("Current beam shape:", cur_beam.shape)
    #print(cur_beam)

    #for i, (pred, target) in enumerate(zip(cur_beam[0, :], data[0, :])):
    #    print(f"Step {i+1}: Predicted: {pred.item():.4f}, Target: {target.item():.4f}")

    # make a plot
    import matplotlib.pyplot as plt
    #plt.plot(cur_beam[0, :].numpy(), label='Predicted')
    for i, beam in enumerate(beams):
        plt.plot(beam[0, :].numpy(), label=f'Beam {i+1}', alpha=0.5)
    plt.plot(data[0, :].numpy(), label='Target', linestyle='--')
    plt.xlabel('Time Step')
    plt.ylabel('Value')
    plt.title('Predicted vs Target Values')
    plt.legend()
    plt.show()