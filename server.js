const { ethers } = require('ethers');
const express = require('express');
const { default: Moralis } = require('moralis');
const { EvmChain } = require('@moralisweb3/evm-utils');
const { readFileSync } = require('fs');
const { join } = require('path');
const { default: helmet } = require('helmet');
const ExpressBrute = require('express-brute');
const compression = require('compression');
const { createClient } = require('redis');

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
// app.use(
//     cors({
//         origin: "*",
//     })
// );
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

    subRegistry.on('newTokenOwner', async (from, to, tokenId) => {
        let recieverTokens = dataMumbai.get(to);
        if (recieverTokens == undefined) recieverTokens = [];
        else recieverTokens = Array.from(recieverTokens);

        recieverTokens.push(tokenId);
        dataMumbai.set(`${to.slice(2)}-${subRegistry.address.slice(2)}`, recieverTokens);
        await client.set(`${to.slice(2)}-${subRegistry.address.slice(2)}`, recieverTokens);

        if (from != '0x0000000000000000000000000000000000000000') {
            let senderTokens = dataMumbai.get(from);
            if (senderTokens == undefined) senderTokens = [];
            else senderTokens = Array.from(senderTokens);

            senderTokens.splice(senderTokens.indexOf(tokenId), 1);
            dataMumbai.set(`${from.slice(2)}-${subRegistry.address.slice(2)}`, senderTokens);
            await client.set(`${from.slice(2)}-${subRegistry.address.slice(2)}`, senderTokens);
        }
    })

    subRegistryContracts.push(subRegistry);
})

app.get('/tokens/:address', bruteforce.prevent, async (req, res) => {
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

        subRegistry.on('newTokenOwner', async (from, to, tokenId) => {
            let recieverTokens = await client.get(`${to.toLowerCase().slice(2)}-${subRegistry.address.toLowerCase().slice(2)}`);
            recieverTokens = JSON.parse(recieverTokens);

            if (recieverTokens == undefined) recieverTokens = [];
            else recieverTokens = Array.from(recieverTokens);

            recieverTokens.push(tokenId);
            await client.set(`${to.slice(2)}-${subRegistry.address.slice(2)}`, recieverTokens);

            if (from != '0x0000000000000000000000000000000000000000') {
                let senderTokens = await client.get(`${from.toLowerCase().slice(2)}-${subRegistry.address.toLowerCase().slice(2)}`);
                senderTokens = JSON.parse(senderTokens);

                if (senderTokens == undefined) senderTokens = [];
                else senderTokens = Array.from(senderTokens);

                senderTokens.splice(senderTokens.indexOf(tokenId), 1);
                await client.set(`${from.slice(2)}-${subRegistry.address.slice(2)}`, senderTokens);
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
                if (maxBlock < tmp[j].block_number) await client.set('max_block', tmp[j].block_number + 1);

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

