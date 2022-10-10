const { ethers } = require('ethers');
const express = require('express');
const { default: Moralis } = require('moralis');
const { EvmChain } = require('@moralisweb3/evm-utils');
const { readFileSync } = require('fs');
const { join } = require('path');
const { default: helmet } = require('helmet');
const ExpressBrute = require('express-brute');
const compression = require('compression');

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

    subRegistry.on('newTokenOwner', async (from, to, tokenURI) => {
        let recieverTokens = dataMumbai.get(to);
        if (recieverTokens == undefined) recieverTokens = [];
        else recieverTokens = Array.from(recieverTokens);

        recieverTokens.push(tokenURI);
        dataMumbai.set(to, recieverTokens);

        if (from != '0x0000000000000000000000000000000000000000') {
            let senderTokens = dataMumbai.get(from);
            if (senderTokens == undefined) senderTokens = [];
            else senderTokens = Array.from(senderTokens);

            senderTokens.splice(senderTokens.indexOf(tokenURI), 1);
            dataMumbai.set(from, senderTokens);
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

    res.send(data.get(address.toLowerCase()));
})

app.listen('8080', async () => {
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

        subRegistry.on('newTokenOwner', async (from, to, tokenURI) => {
            let recieverTokens = dataMumbai.get(to);
            if (recieverTokens == undefined) recieverTokens = [];
            else recieverTokens = Array.from(recieverTokens);

            recieverTokens.push(tokenURI);
            dataMumbai.set(to, recieverTokens);

            if (from != '0x0000000000000000000000000000000000000000') {
                let senderTokens = dataMumbai.get(from);
                if (senderTokens == undefined) senderTokens = [];
                else senderTokens = Array.from(senderTokens);

                senderTokens.splice(senderTokens.indexOf(tokenURI), 1);
                dataMumbai.set(from, senderTokens);
            }
        })

        subRegistryContracts.push(subRegistry);

        const response = await Moralis.EvmApi.events.getContractEvents({
            address: subRegistryAddressesMumbai[i],
            chain: EvmChain.MUMBAI,
            abi: {
                "anonymous": false,
                "inputs": [
                    {
                        "indexed": false,
                        "internalType": "address",
                        "name": "from",
                        "type": "address"
                    },
                    {
                        "indexed": false,
                        "internalType": "address",
                        "name": "to",
                        "type": "address"
                    },
                    {
                        "indexed": false,
                        "internalType": "string",
                        "name": "tokenURI",
                        "type": "string"
                    }
                ],
                "name": "newTokenOwner",
                "type": "event"
            },
            topic: '0xd5e6d26e46c1b4a57e0f23e05f934fd3ed3c2c8ff2a3564ddba5303692d9deed'
        });

        let tmp = Array.from(response.raw.result);

        if (tmp[0] != undefined) {
            for (let j = tmp.length - 1; j >= 0; j--) {
                let recieverTokens = dataMumbai.get(tmp[j].data.to);
                if (recieverTokens == undefined) recieverTokens = [];
                else recieverTokens = Array.from(recieverTokens);

                recieverTokens.push(tmp[j].data.tokenURI);
                dataMumbai.set(tmp[j].data.to, recieverTokens);

                if (tmp[j].data.from != '0x0000000000000000000000000000000000000000') {
                    let senderTokens = dataMumbai.get(tmp[j].data.from);
                    if (senderTokens == undefined) senderTokens = [];
                    else senderTokens = Array.from(senderTokens);

                    senderTokens.splice(senderTokens.indexOf(tmp[j].data.tokenURI), 1);
                    dataMumbai.set(tmp[j].data.from, senderTokens);
                }
            }
        }
    }
    console.log('server initialized');
});

