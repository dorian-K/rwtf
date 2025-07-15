import pandas as pd
import os
import torch
import json
import datetime
from torch.utils.data import DataLoader

import random
from torch.optim.swa_utils import AveragedModel, SWALR

from .data import dataset, validation_dataset, dataset_recent, dataset_arrival, validation_dataset_arrival, dataset_arrival_recent
from .model import TransformerDecoder

use_arrival_data = True  
main_ds = dataset_arrival if use_arrival_data else dataset
validation_ds = validation_dataset_arrival if use_arrival_data else validation_dataset
main_recent_ds = dataset_arrival_recent if use_arrival_data else dataset_recent

# create the model
model = TransformerDecoder(d_model=128, nhead=1, num_layers=2, dropout_rate=0.0, maxval=dataset.maxval, logscale_tricks=False)
# print the model
print(model)
print("Model parameters:", sum(p.numel() for p in model.parameters()))
print("Model trainable parameters:", sum(p.numel() for p in model.parameters() if p.requires_grad))  # Exclude biases

# model = torch.compile(model, fullgraph=True)  # Compile the model for better performance

# Example training loop (quick and dirty)

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = model.to(device)

learning_rate = 1e-3
optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=0)
criterion = torch.nn.MSELoss()
#criterion = torch.nn.L1Loss()  # Use L1 loss for robustness against outliers

dataloader_train = DataLoader(main_ds, batch_size=8, shuffle=True)
dataloader_validation = DataLoader(validation_ds, batch_size=8, shuffle=False)

EPOCHS = 50
SWITCH_TO_RECENT_AT = 45
ENABLE_SEQUENCE_TRAINING_AT = 40

all_stats = []

def save_all_stats():
    # save all stats to a single file
    with open(os.path.join(os.path.dirname(__file__), "models/stats.json"), 'w') as f:
        json.dump(all_stats, f, indent=4)

for epoch in range(EPOCHS):
    model.train()
    total_loss = 0
    total_loss_validation = 0
    step_train = 0
    for batch in dataloader_train:
        batch: torch.Tensor = batch.to(device)
        optimizer.zero_grad()
        in_x = batch[:, :-1]  # (batch_size, seq_length-1)
        cur_batchsize = in_x.size(0)

        # sequence training
        if random.random() < 0.5 and epoch > ENABLE_SEQUENCE_TRAINING_AT:
            start_search_at = random.randint(1, in_x.size(1) - 1)

            in_x_search = in_x[:, :start_search_at].clone()
            while in_x_search.size(1) < in_x.size(1):
                output = model(in_x_search)
                output = output.permute(1, 0, 2)  # (batch_size, seq_length-1, 1)
                next_value = output[:, -1, 0].unsqueeze(1)  #
                in_x_search = torch.cat((in_x_search, next_value), dim=1)  # (batch_size, seq_length)
            in_x = in_x_search  # Use the search input for training

        output = model(in_x) # (seq_length, batch_size, 1)

        # we want to predict the next value, so we need to shift the output by one
        target = batch[:, 1:]
        output = output.permute(1, 0, 2)  # (batch_size, seq_length-1, 1)
        #loss = criterion(torch.log(1 + output), torch.log(1 + target.unsqueeze(-1)))  # target needs to be of shape (batch_size, seq_length, 1)
        loss = criterion(output, target.unsqueeze(-1))  # target needs to be of shape (batch_size, seq_length, 1)
        # loss = loss / cur_batchsize # feels right
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)  # Gradient clipping
        optimizer.step()
        total_loss += loss.item()
        step_train += 1
        if step_train % 10 == 0:
            print(f"Epoch {epoch}/{EPOCHS}, Step {step_train}, Loss: {loss.item():.4f}")
    # Validation 
    model.eval()
    step_valid = 0
    for batch in dataloader_validation:

        batch = batch.to(device)
        with torch.no_grad():
            in_x = batch[:,:-1]
            output = model(in_x)
            target = batch[:, 1:]
            output = output.permute(1, 0, 2)  # (batch_size, seq_length-1, 1)

            if step_valid == 0:
                print("Input", in_x.shape)
                print("Output", output.shape)
                # print first batch dimension
                fr = 60
                to = fr + 20
                expected = target[0, fr:to].tolist()
                predicted = output[0, fr:to, 0].tolist()
                # zip them together
                for i, (exp, pred) in enumerate(zip(expected, predicted)):
                   print(f"Validation t={i+1}: Expected: {exp:.2f}, Predicted: {pred:.2f}")

            loss = criterion(output, target.unsqueeze(-1))
            total_loss_validation += loss.item()
            step_valid += 1

    
        # decrease learning rate
        # if epoch < swa_start and epoch % 50 == 0:
        #     learning_rate *= 0.5
        #     for param_group in optimizer.param_groups:
        #         param_group['lr'] *= learning_rate
        
    if epoch == SWITCH_TO_RECENT_AT:
        dataloader_train = DataLoader(main_recent_ds, batch_size=24, shuffle=True)
    
    # also save stats
    stats = {
        'epoch': epoch,
        'train_loss': total_loss / step_train,
        'valid_loss': total_loss_validation / step_valid,
        'date': datetime.datetime.now().isoformat(),
        'learning_rate': learning_rate,
    }
    all_stats.append(stats)
    if epoch % 20 == 0:
        torch.save(model, os.path.join(os.path.dirname(__file__), f'models/model_epoch_{epoch}.ptp'))
        with open(os.path.join(os.path.dirname(__file__), f"models/stats_epoch_{epoch}.json"), 'w') as f:
            import json
            json.dump(stats, f, indent=4)
        save_all_stats()
    # elif epoch <= 10:
    #     for param_group in optimizer.param_groups:
    #         param_group['lr'] = epoch / 10 * learning_rate

    print(f"Epoch {epoch}/{EPOCHS}, Training Loss: {total_loss/step_train:.4f}, Validation Loss: {total_loss_validation/step_valid:.4f}")

# save the final model
torch.save(model, os.path.join(os.path.dirname(__file__), "models/model_final.ptp"))
# summarize all stats
save_all_stats()


