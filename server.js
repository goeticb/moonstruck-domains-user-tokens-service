const { ethers } = require('ethers');
const express = require('express');
const { default: Moralis } = require('moralis');
const { EvmChain } = require('@moralisweb3/evm-utils');
const { readFileSync } = require('fs');
const { join } = require('path');

const app = express();
const registryABI = JSON.parse(readFileSync(join(__dirname, '/contracts/Registry.json'), 'utf-8'));
const REGISTRY_ADDRESS = '0x80f6B4d8fd67431D19EC9509f03F99eF9053e203';

Moralis.start({
    apiKey: process.env.MORALIS_API_KEY,
});

app.get('/tokens', async (req, res) => {
    const myAddress = req.query.address;

    if (myAddress == undefined) {
        res.status(400).send('error, address not provided');
        return;
    }

    if (!ethers.utils.isAddress(myAddress)) {
        res.status(400).send('error, address not valid')
        return;
    }

    const topLevelDomains = await Moralis.EvmApi.utils.runContractFunction({
        abi: registryABI.abi,
        functionName: 'getTopLevelDomains',
        address: REGISTRY_ADDRESS,
        chain: EvmChain.MUMBAI,
    });

    let i = 0;
    let subRegistryAddresses = [];
    while (topLevelDomains.result[i] != undefined) {
        const topLevelDomainAddress = await Moralis.EvmApi.utils.runContractFunction({
            abi: registryABI.abi,
            functionName: 'getRegistry',
            address: REGISTRY_ADDRESS,
            chain: EvmChain.MUMBAI,
            params: { topLevelDomain: topLevelDomains.result[i] },
        });
        subRegistryAddresses[i] = topLevelDomainAddress.result;
        i++;
    }

    const response = await Moralis.EvmApi.nft.getWalletNFTs({
        address: myAddress,
        chain: EvmChain.MUMBAI,
        tokenAddresses: subRegistryAddresses,
    });

    i = 0;
    let tokens = [];
    while (response.result[i] != undefined) {
        tokens[i] = response.result[i].tokenUri;
        i++;
    }

    res.send(tokens);
})

app.listen('8080');

