# Backend service

Backend service that helps get necessary data from the blockchain, and provides that data to our front end.

## Installation

Just download and do the npm install.

## Usage

The first route (/tokens/:address) returns all tokenId-s that are owned by the address for each subdomain.

The second route (/records/:address) returns all records from the given resolver.

## Environment variables

REDIS_URL - The URL to our Redis database <br/>
REDIS_PASSWORD - Password for accessing our Redis database <br/> 
REDIS_DATABASE_NAME - Name of our Redis database <br/>
MORALIS_API_KEY - Moralis API key

## How does it work

On the initialization of our server firstly we get all the addresses of all the sub-registries from our registry. Then we instantiate all the sub-registries and make each of them listen for a Transfer event so we can update our database. After that we fetch data from the blockchain and get all the Transfer events from our sub-registries, so we can provide data for our database. Data is being fetched from either from first block (if the server is being initialized for the first time), or from the latest block that emitted the Transfer event on one of our sub-registries.

Our /tokens/:address route returns data that we fetched from the blockchain, it gets it from our database. <br/>
Our /records/:address route gets data via Moralis every single time.

### Note
When saving data to our database we slice the first two letters from each address for memory saving. 
