#!/usr/bin/env python3

import requests
from bs4 import BeautifulSoup
import json
from dotenv import load_dotenv
import os

load_dotenv()

server_url = os.getenv("SERVER_URL")
assert server_url, "SERVER_URL must be set in .env"


def grab_data(url):

    # Fetch the page content
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
    }
    response = requests.get(url, headers=headers)
    response.raise_for_status()

    # Parse the HTML content
    soup = BeautifulSoup(response.text, "html.parser")

    # Locate the table
    table = soup.find("table", class_="table-sortable")

    # Extract table rows
    rows = table.find_all("tr")

    keypath = "#breadcrumbs > nav > div > div > ol > li:nth-child(3) > a"
    valuepath = "#breadcrumbs > nav > div > div > ol > li:nth-child(4) > div"
    key = soup.select_one(keypath).get_text(strip=True)
    value = soup.select_one(valuepath).get_text(strip=True)
    key = key.replace("Organisationen", "Organisation")

    table_data = []
    header = []
    for row in rows:
        cells = row.find_all("td")
        if cells:
            assert len(header) > 0, "Header must be defined before data"
            data = [cell.get_text(strip=True) for cell in cells]
            data = data + [value]

            if len(data) != len(header):
                print(
                    f"Row {data} has different number of columns than header {header}"
                )
                continue
            if data[0] == "Gesamt":
                break
            idx_for_online = header.index("Online")
            # online col has an <i> tag with class "fa fa-check"
            data[idx_for_online] = (
                "fa-check" in cells[idx_for_online].find("i")["class"]
            )

            data = dict(zip(header, data))

            table_data.append(data)
        else:
            header = row.find_all("th")
            if header:
                header = [cell.get_text(strip=True) for cell in header]
                assert key not in header
                header = header + [key]
                print(header)

    import time

    time.sleep(1)
    return table_data


orgs = [
    "ORG-42NHW",  # itcenter
    "ORG-46EVW",  # bib
    "ORG-59BSY",  # hsz
    "ORG-87MDR",  # fsmpi
]
buildings = [
    "1960",  # academica
    "2356",  # as55 e12
    "1385",  # carl
    "1580",  # semi90
]

# todo error handling
all_data = []
for org in orgs:
    url = (
        f"https://noc-portal.itc.rwth-aachen.de/mops-admin/coverage/organizations/{org}"
    )
    all_data.extend(grab_data(url))

for building in buildings:
    url = f"https://noc-portal.itc.rwth-aachen.de/mops-admin/coverage/buildings/{building}"
    all_data.extend(grab_data(url))

# combine all data
header = list(all_data[0].keys())
seen_aps = set()
table_data = []
for data in all_data:
    if data["Name"] not in seen_aps:
        vals = []
        assert len(data) == len(header) and all(
            key in header for key in data
        ), f"Data {data} does not match header {header}"
        for key in header:
            vals.append(data[key])
        table_data.append(vals)
        seen_aps.add(data["Name"])

send_data = {
    "version": 1,
    "header": header,
    "data": table_data,
}

print(seen_aps)
# print(send_data)
json_data = json.dumps(send_data)

headers = {"Content-Type": "application/json"}
response = requests.post(server_url, data=json_data, headers=headers)

print(f"Status code: {response.status_code}")
print(f"Response: {response.text}")
# dump the response on error
if response.status_code != 200:
    print(f"Response: {response}")
