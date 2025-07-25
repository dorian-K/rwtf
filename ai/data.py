import pandas as pd
import os
import torch
import datetime
from torch.utils.data import DataLoader
import torch.nn as nn
import random

pd.set_option("future.no_silent_downcasting", True)
pd.set_option('display.max_rows', 500)
pd.set_option('display.max_columns', 500)
pd.set_option('display.width', 150)


# read csv
df = pd.read_csv(os.path.join(os.path.dirname(__file__), 'data', 'out.csv'), header=None, names=['id', 'value', 'time'])
df['time'] = pd.to_datetime(df['time'])
df['value'] = df['value'].astype(float)
# we dont really need the id, so we can drop it
df = df.drop(columns=['id'])

# drop all rows where value is > 250
df = df[df['value'] <= 250]

# group by day
df['day'] = df['time'].dt.date
grouped = df.groupby('day')

print("Number of days:", len(grouped))
print("Day with most data:", grouped.size().idxmax(), "with", grouped.size().max(), "entries")
print("Day with least data:", grouped.size().idxmin(), "with", grouped.size().min(), "entries")
# drop all days with less than 200 entries
grouped = grouped.filter(lambda x: len(x) >= 200)
grouped = grouped.groupby('day')

print("Number of days after filtering:", len(grouped))


# create a dictionary with day as key and values as list of values
# now our data is a bit problematic:
# the created_at is not aligned to any particular grid, so we would need to resample it
# so lets do that here, we just do a list for values every 5 minutes, starting at 06:00 and ending at 23:30
# we use linear interpolation to fill the gaps
day_data = {}
day_arrival_data = {}
# print the 100 largest values
largest_values = df["value"].nlargest(20)
#print("100 largest values:")
#print(largest_values)

NUM_TIME_PER_DAY = 215

def day_into_arrival_data(day_data: list[float]):
    # the system registers when a member enters, and removes them exactly 1:30h later
    # so we remove this effect here such that we have a predictor of when people arrive

    arrival_data = []
    for i in range(len(day_data)):
        val = day_data[i]
        for j in range(i - 17, i):
            if j < 0:
                continue
            val -= arrival_data[j]
        val = max(0, val)  # ensure no negative values
        arrival_data.append(val)

    return arrival_data

for day, group in grouped:
    # create a date range for the day with 5 minute frequency
    date_range = pd.date_range(start=f"{day} 06:00:00", end=f"{day} 23:50:00", freq='5min')
    assert len(date_range) == NUM_TIME_PER_DAY, f"Expected {NUM_TIME_PER_DAY} time points for day {day}, got {len(date_range)}"
    # ensure 'time' index is unique before reindexing
    group = group.drop_duplicates(subset='time')
    # reindex the group to this date range
    group = group.set_index('time')
    group = group.drop(columns=['day'])
    group = group.reindex(group.index.union(date_range))

    group = group.interpolate(method='linear', fill_value="extrapolate")
    #group = group.interpolate(method='nearest', fill_value="extrapolate")

    group = group.reindex(date_range, method='nearest', tolerance=pd.Timedelta('1min'))
    group = group.fillna(0)  # fill any remaining NaNs with 0
   
    day_data[day] = group['value'].tolist()
    day_arrival_data[day] = day_into_arrival_data(day_data[day])

# our data is somewhat ready, we can now create a dataset class
class TimeSeriesDataset(torch.utils.data.Dataset):
    def __init__(self, day_data, day_multiplier=20):
        self.day_data = day_data
        self.days = list(day_data.keys())
        self.maxval = max(max(values) for values in day_data.values())
        self.day_multiplier = day_multiplier
        print(f"Max value in dataset: {self.maxval}, day multiplier: {self.day_multiplier}")


    def __len__(self):
        return len(self.days)

    def __getitem__(self, idx):
        day = self.days[idx]
        values = self.day_data[day]
        assert len(values) == NUM_TIME_PER_DAY,  f"Expected {NUM_TIME_PER_DAY} values for day {day}, got {len(values)}"
        day_of_week = day.weekday()  # 0=Monday, 6=Sunday
        values = [self.day_multiplier * day_of_week] + values  # prepend the day of the week
        return torch.tensor(values, dtype=torch.float32)

# create the dataset
validation_days = []
# select 10% of the days randomly for validation

random.seed(42)  # for reproducibility
validation_days = random.sample(list(day_data.keys()), k=max(1, len(day_data)) // 10)
# create a dataset for training and validation
train_day_data = {day: values for day, values in day_data.items() if day not in validation_days}
train_day_data_recent = {day: values for day, values in train_day_data.items() if day >= datetime.date(2024, 11, 1) and day not in validation_days}
validation_day_data = {day: values for day, values in day_data.items() if day in validation_days}
print(f"Training on {len(train_day_data)} days, validation on {len(validation_day_data)} days")

# create the datasets
dataset = TimeSeriesDataset(train_day_data)
dataset_recent = TimeSeriesDataset(train_day_data_recent)
validation_dataset = TimeSeriesDataset(validation_day_data)

train_data_day_arrival = {day: values for day, values in day_arrival_data.items() if day not in validation_days}
train_data_day_arrival_recent = {day: values for day, values in train_data_day_arrival.items() if day >= datetime.date(2024, 11, 1) and day not in validation_days}
validation_data_day_arrival = {day: values for day, values in day_arrival_data.items() if day in validation_days}
print(f"Training on {len(train_data_day_arrival)} days, validation on {len(validation_data_day_arrival)} days for arrival data")

dataset_arrival = TimeSeriesDataset(train_data_day_arrival, day_multiplier=3)
dataset_arrival_recent = TimeSeriesDataset(train_data_day_arrival_recent, day_multiplier=3)
validation_dataset_arrival = TimeSeriesDataset(validation_data_day_arrival, day_multiplier=3)