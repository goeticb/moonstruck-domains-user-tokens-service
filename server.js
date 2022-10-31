const { ethers, BigNumber } = require('ethers');
const express = require('express');
const { default: Moralis } = require('moralis');
const { EvmChain } = require('@moralisweb3/evm-utils');
const { readFileSync } = require('fs');
const { join } = require('path');
const { default: helmet } = require('helmet');
const ExpressBrute = require('express-brute');
const compression = require('compression');
const { createClient } = require('redis');
const cors = require('cors');

const client = createClient({
    url: process.env.REDIS_URL,
    password: process.env.REDIS_PASSWORD,
    name: process.env.REDIS_DATABASE_NAME,
});

client.on('error', (err) => console.log('Redis Client Error', err));

const store = new ExpressBrute.MemoryStore();
const bruteforce = new ExpressBrute(store);

const app = express();
app.use(helmet.contentSecurityPolicy());
app.use(
    cors({
        origin: "*",
    })
);
app.use(helmet.dnsPrefetchControl());
app.use(helmet.expectCt());
app.use(helmet.frameguard());
app.use(helmet.hidePoweredBy());
app.use(helmet.hsts());
app.use(helmet.ieNoOpen());
app.use(helmet.noSniff());
app.use(helmet.originAgentCluster());
app.use(helmet.permittedCrossDomainPolicies());
app.use(helmet.referrerPolicy());
app.use(helmet.xssFilter());
app.use(compression());

const registryABI = JSON.parse(readFileSync(join(__dirname, '/contracts/Registry.json'), 'utf-8'));
const subRegistryABI = JSON.parse(readFileSync(join(__dirname, '/contracts/SubRegistry.json'), 'utf-8'));
const REGISTRY_ADDRESS_MUMBAI = '0xB54f8F785907740bDDebF0c6204d288c4836b9f5';
const REGISTRY_ADDRESS_MAINNET = '';

const registryMumbai = new ethers.Contract(REGISTRY_ADDRESS_MUMBAI, registryABI.abi, new ethers.providers.JsonRpcProvider('https://rpc-mumbai.maticvigil.com/'));
const registryMainnet = new ethers.Contract(REGISTRY_ADDRESS_MAINNET, registryABI.abi, new ethers.providers.JsonRpcProvider('https://rpc-mumbai.maticvigil.com/'));

let subRegistryContracts = [];
let dataMumbai = new Map();
let dataMainnet = new Map();

Moralis.start({
    apiKey: process.env.MORALIS_API_KEY,
});

registryMumbai.on('newSubRegistry', (newSubRegistryAddress) => {
    const subRegistry = new ethers.Contract(newSubRegistryAddress, subRegistryABI.abi, new ethers.providers.JsonRpcProvider('https://rpc-mumbai.maticvigil.com/'));

    subRegistry.on('Transfer', async (from, to, tokenId) => {
        const blockNumber = await subRegistry.provider.getBlockNumber();
        await client.set('max_block', blockNumber + 1);

        let recieverTokens = await client.get(`${to.toLowerCase().slice(2)}-${subRegistry.address.toLowerCase().slice(2)}`);

        recieverTokens = JSON.parse(recieverTokens);

        if (recieverTokens == undefined) recieverTokens = [];
        else recieverTokens = Array.from(recieverTokens);

        recieverTokens.push(BigNumber.from(tokenId).toString());

        await client.set(`${to.toLowerCase().slice(2)}-${subRegistry.address.toLowerCase().slice(2)}`, JSON.stringify(recieverTokens));

        if (from != '0x0000000000000000000000000000000000000000') {
            let senderTokens = await client.get(`${from.toLowerCase().slice(2)}-${subRegistry.address.toLowerCase().slice(2)}`);
            senderTokens = JSON.parse(senderTokens);

            if (senderTokens == undefined) senderTokens = [];
            else senderTokens = Array.from(senderTokens);

            senderTokens.splice(senderTokens.indexOf(tokenId.toString()), 1);

            await client.set(`${from.toLowerCase().slice(2)}-${subRegistry.address.toLowerCase().slice(2)}`, JSON.stringify(senderTokens));
        }
    })

    subRegistryContracts.push(subRegistry);
})

app.get('/tokens/:address', /*bruteforce.prevent,*/ async (req, res) => {
    const { address } = req.params;
    const { network } = req.query;
    let data;

    if (!ethers.utils.isAddress(address) || address == undefined) return res.status(400).send('invalid address');

    if (network == 'mumbai') data = dataMumbai;
    else if (network == 'mainnet') contract = dataMainnet;
    else return res.status(400).send('invalid network')

    let myResponse = {};
    for (let i = 0; i < subRegistryContracts.length; i++) {
        let value = await client.get(`${address.toLowerCase().slice(2)}-${subRegistryContracts[i].address.toLowerCase().slice(2)}`);

        if (value != null && value != '[]') {
            value = JSON.parse(value);
            myResponse[subRegistryContracts[i].address] = value;
        }

    }
    res.send(myResponse);
})

app.get('/records/:address', async (req, res) => {
    const { address } = req.params;
    const { network } = req.query;
    let chain;

    if (!ethers.utils.isAddress(address) || address == undefined) return res.status(400).send('invalid address');

    if (network == 'mumbai') chain = EvmChain.MUMBAI;
    else if (network == 'mainnet') chain = EvmChain.POLYGON;
    else return res.status(400).send('invalid network');

    const response = await Moralis.EvmApi.events.getContractEvents({
        address: address,
        chain: chain,
        abi: {
            "anonymous": false,
            "inputs": [
                {
                    "indexed": false,
                    "internalType": "uint256",
                    "name": "_type",
                    "type": "uint256"
                },
                {
                    "indexed": false,
                    "internalType": "string",
                    "name": "key",
                    "type": "string"
                },
                {
                    "indexed": false,
                    "internalType": "bytes",
                    "name": "value",
                    "type": "bytes"
                }
            ],
            "name": "RecordSet",
            "type": "event"
        },
        topic: '0x9551980f56ab4a38eeda798fa201134d95d98db4d3ad60d8ce7b9a29f3681cb7'
    });

    let data = new Map();
    let tmp = Array.from(response.raw.result);

    for (let i = tmp.length - 1; i >= 0; i--) data.set(`${tmp[i].data._type} + ${tmp[i].data.key}`, tmp[i].data.value);

    let myResponse = Object.fromEntries(data);
    res.send(myResponse);
})

app.listen('8080', async () => {
    await client.connect();

    const nextBlock = parseInt(await client.get('max_block'));
    let subRegistryAddressesMumbai = [];
    const topLevelDomains = await registryMumbai.getTopLevelDomains();

    let i = 0;
    while (topLevelDomains[i] != undefined) {
        subRegistryAddressesMumbai[i] = await registryMumbai.getRegistry(topLevelDomains[i]);
        i++;
    }

    subRegistryAddressesMumbai = Array.from(subRegistryAddressesMumbai);

    for (i = 0; i < subRegistryAddressesMumbai.length; i++) {
        const subRegistry = new ethers.Contract(subRegistryAddressesMumbai[i], subRegistryABI.abi, new ethers.providers.JsonRpcProvider('https://rpc-mumbai.maticvigil.com/'));

        subRegistry.on('Transfer', async (from, to, tokenId) => {
            const blockNumber = await subRegistry.provider.getBlockNumber();
            await client.set('max_block', blockNumber + 1);

            let recieverTokens = await client.get(`${to.toLowerCase().slice(2)}-${subRegistry.address.toLowerCase().slice(2)}`);

            recieverTokens = JSON.parse(recieverTokens);

            if (recieverTokens == undefined) recieverTokens = [];
            else recieverTokens = Array.from(recieverTokens);

            recieverTokens.push(BigNumber.from(tokenId).toString());

            await client.set(`${to.toLowerCase().slice(2)}-${subRegistry.address.toLowerCase().slice(2)}`, JSON.stringify(recieverTokens));

            if (from != '0x0000000000000000000000000000000000000000') {
                let senderTokens = await client.get(`${from.toLowerCase().slice(2)}-${subRegistry.address.toLowerCase().slice(2)}`);
                senderTokens = JSON.parse(senderTokens);

                if (senderTokens == undefined) senderTokens = [];
                else senderTokens = Array.from(senderTokens);

                senderTokens.splice(senderTokens.indexOf(tokenId.toString()), 1);

                await client.set(`${from.toLowerCase().slice(2)}-${subRegistry.address.toLowerCase().slice(2)}`, JSON.stringify(senderTokens));
            }
        })

        subRegistryContracts.push(subRegistry);

        const response = await Moralis.EvmApi.events.getContractEvents({
            address: subRegistryAddressesMumbai[i],
            chain: EvmChain.MUMBAI,
            fromBlock: nextBlock,
            abi: {
                "anonymous": false,
                "inputs": [
                    {
                        "indexed": true,
                        "internalType": "address",
                        "name": "from",
                        "type": "address"
                    },
                    {
                        "indexed": true,
                        "internalType": "address",
                        "name": "to",
                        "type": "address"
                    },
                    {
                        "indexed": true,
                        "internalType": "uint256",
                        "name": "tokenId",
                        "type": "uint256"
                    }
                ],
                "name": "Transfer",
                "type": "event"
            },
            topic: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
        });

        let tmp = Array.from(response.raw.result);

        if (tmp[0] != undefined) {
            for (let j = tmp.length - 1; j >= 0; j--) {
                const maxBlock = parseInt(await client.get('max_block'));
                if (maxBlock < tmp[j].block_number) await client.set('max_block', parseInt(tmp[j].block_number) + 1);

                let recieverTokens = await client.get(`${tmp[j].data.to.toLowerCase().slice(2)}-${tmp[j].address.toLowerCase().slice(2)}`);
                recieverTokens = JSON.parse(recieverTokens);

                if (recieverTokens == undefined) recieverTokens = [];
                else recieverTokens = Array.from(recieverTokens);

                recieverTokens.push(tmp[j].data.tokenId);

                await client.set(`${tmp[j].data.to.slice(2)}-${tmp[j].address.slice(2)}`, JSON.stringify(recieverTokens));

                if (tmp[j].data.from != '0x0000000000000000000000000000000000000000') {
                    let senderTokens = await client.get(`${tmp[j].data.from.toLowerCase().slice(2)}-${tmp[j].address.toLowerCase().slice(2)}`);
                    senderTokens = JSON.parse(senderTokens);

                    if (senderTokens == undefined) senderTokens = [];
                    else senderTokens = Array.from(senderTokens);

                    senderTokens.splice(senderTokens.indexOf(tmp[j].data.tokenId), 1);

                    await client.set(`${tmp[j].data.from.slice(2)}-${tmp[j].address.slice(2)}`, JSON.stringify(senderTokens));
                }
            }
        }
    }

    console.log('server initialized');
});

