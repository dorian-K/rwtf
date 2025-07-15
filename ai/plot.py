import os
from matplotlib import pyplot as plt
import pandas as pd

# read from models/stats.json, it looks like this:
"""
[
    {
        "epoch": 0,
        "train_loss": 17.2893794740288,
        "valid_loss": 4.9996739228566485,
        "date": "2025-07-15T17:58:00.165510",
        "learning_rate": 1e-05
    },
    ...
]
"""

with open(os.path.join(os.path.dirname(__file__), 'models', 'stats.json'), 'r') as f:
    stats = pd.read_json(f)

# plot train_loss and valid_loss over epochs
plt.figure(figsize=(12, 6))
plt.plot(stats['epoch'], stats['train_loss'], label='Train Loss', marker='o', linestyle='-')
plt.plot(stats['epoch'], stats['valid_loss'], label='Validation Loss', marker='x', linestyle='--')
plt.xlabel('Epoch')
plt.ylabel('Loss')
plt.title('Train and Validation Loss Over Epochs')
plt.xticks(stats['epoch'])  # Ensure all epochs are shown on x-axis
plt.yscale('log')  # Use logarithmic scale for better visibility of loss values
plt.grid(True)
plt.legend()
plt.tight_layout()
#plt.savefig(os.path.join(os.path.dirname(__file__), 'models', 'loss_plot.png'))
plt.show()