util = require('util');
path = require("path");
JSONbig = require('json-bigint');
argv = require('minimist')(process.argv.slice(2));
prompt = require('prompt');
EVMBabbleClient = require('./evm-babble-client.js');
Contract = require('./contract-lite.js');
Accounts = require('web3-eth-accounts');

let accounts = new Accounts('');

//------------------------------------------------------------------------------
//Console colors

FgRed = "\x1b[31m";
FgGreen = "\x1b[32m";
FgYellow = "\x1b[33m";
FgBlue = "\x1b[34m";
FgMagenta = "\x1b[35m";
FgCyan = "\x1b[36m";
FgWhite = "\x1b[37m";


log = function (color, text) {
    console.log(color + text + '\x1b[0m');
};

step = function (message) {
    log(FgWhite, '\n' + message);
    return new Promise((resolve) => {
        prompt.get('PRESS ENTER TO CONTINUE', function (err, res) {
            resolve();
        });
    })
};

explain = function (message) {
    log(FgCyan, util.format('\nEXPLANATION:\n%s', message))
};

space = function () {
    console.log('\n');
};

//------------------------------------------------------------------------------

sleep = function (time) {
    return new Promise((resolve) => setTimeout(resolve, time));
};

//..............................................................................

function DemoNode(name, host, port) {
    this.name = name;
    this.api = new EVMBabbleClient(host, port);
    this.accounts = {};
}

//------------------------------------------------------------------------------

let _demoNodes = [];
let _contractFile = 'product.sol';
let _mpContract;
let _keystore = 'keystore';
let _pwdFile = 'pwd.txt';
let _wallet;

init = function () {
    console.log(argv);
    let ips = argv.ips.split(",");
    let port = argv.port;
    _contractFile = argv.contract;
    _keystore = argv.keystore;
    _pwdFile = argv.pwd;

    let keystoreArray = readKeyStore(_keystore);
    let pwd = readPassFile(_pwdFile);
    _wallet = accounts.wallet.decrypt(keystoreArray, pwd);

    return new Promise((resolve, reject) => {
        for (let i = 0; i < ips.length; i++) {
            let demoNode = new DemoNode(
                util.format('node%d', i + 1),
                ips[i],
                port);
            _demoNodes.push(demoNode);
        }
        resolve()
    });
};

readKeyStore = function (dir) {

    let keystore = [];

    files = fs.readdirSync(dir);

    for (let i = 0, len = files.length; i < len; ++i) {

        filepath = path.join(dir, files[i]);
        if (fs.lstatSync(filepath).isDirectory()) {
            filepath = path.join(filepath, files[i]);
        }

        keystore.push(JSON.parse(fs.readFileSync(filepath)));

    }

    return keystore;

};

readPassFile = function (path) {
    return fs.readFileSync(path, 'utf8');
};

getControlledAccounts = function () {
    log(FgMagenta, 'Getting Accounts');
    return Promise.all(_demoNodes.map(function (node) {
        return node.api.getAccounts().then((accs) => {
            log(FgGreen, util.format('%s accounts: %s', node.name, accs));
            node.accounts = JSONbig.parse(accs).accounts;
        });
    }));
};

transfer = function (from, to, amount) {
    tx = {
        from: from.accounts[0].address,
        to: to.accounts[0].address,
        value: amount
    };

    stx = JSONbig.stringify(tx);
    log(FgMagenta, 'Sending Transfer Tx: ' + stx);

    return from.api.sendTx(stx).then((res) => {
        log(FgGreen, 'Response: ' + res);
        txHash = JSONbig.parse(res).txHash.replace("\"", "");
        return txHash;
    })
};

transferRaw = function (api, from, to, amount) {

    return api.getAccount(from.address).then((res) => {
        log(FgMagenta, 'account: ' + res);
        acc = JSONbig.parse(res);

        tx = {
            from: from.address,
            to: to,
            value: amount,
            nonce: acc.nonce,
            chainId: 1,
            gas: 1000000,
            gasPrice: 0
        };
        privateKey = from.privateKey;

        signedTx = accounts.signTransaction(tx, privateKey);
        console.log("signed tx", signedTx);

        return signedTx;
    })
        .then((signedTx) => api.sendRawTx(signedTx.rawTransaction))
        .then((res) => {
            log(FgGreen, 'Response: ' + res);
            txHash = JSONbig.parse(res).txHash.replace("\"", "");
            return txHash;
        })

};

deployContract = function (from, contractFile, contractName, args) {
    let contract = new Contract(contractFile, contractName);
    contract.compile();

    let constructorParams = contract.encodeConstructorParams(args);

    let tx = {
        from: from.accounts[0].address,
        gas: 1000000,
        gasPrice: 0,
        value: 1111,
        data: contract.bytecode + constructorParams
    };

    let stx = JSONbig.stringify(tx);
    log(FgMagenta, 'Sending Contract-Creation Tx: ' + stx);

    return from.api.sendTx(stx).then((res) => {
        log(FgGreen, 'Response: ' + res);
        let txHash = JSONbig.parse(res).txHash.replace("\"", "");
        return txHash;
    })
        .then((txHash) => {
            return sleep(2000).then(() => {
                log(FgBlue, 'Requesting Receipt');
                return from.api.getReceipt(txHash);
            })
        })
        .then((receipt) => {
            log(FgGreen, 'Tx Receipt: ' + receipt);
            let address = JSONbig.parse(receipt).contractAddress;
            contract.address = address;
            return contract;
        })
};

//------------------------------------------------------------------------------

buy = function (from) {
    let callData = _mpContract.w3.buy.getData();
    log(FgMagenta, util.format('buy() callData: %s', callData));

    let tx = {
        from: from.accounts[0].address,
        to: _mpContract.address,
        gaz: 1000000,
        gazPrice: 0,
        value: 0,
        data: callData
    };
    let stx = JSONbig.stringify(tx);
    log(FgBlue, 'Sending Contract-Method Tx: ' + stx);

    return from.api.sendTx(stx).then((res) => {
        log(FgGreen, 'Response: ' + res);
        return JSONbig.parse(res).txHash.replace("\"", "");
    })
        .then((txHash) => {
            return sleep(2000).then(() => {
                log(FgBlue, 'Requesting Receipt');
                return from.api.getReceipt(txHash);
            })
        })
        .then((receipt) => {
            log(FgGreen, 'Tx Receipt: ' + receipt);

            recpt = JSONbig.parse(receipt);

            logs = _mpContract.parseLogs(recpt.logs);
            logs.map(item => {
                log(FgCyan, item.event + ': ' + JSONbig.stringify(item.args));
            })
        })
};

//------------------------------------------------------------------------------
// DEMO

prompt.start();
prompt.message = '';
prompt.delimiter = '';

init()

    .then(() => step("STEP 1) Get ETH Accounts"))
    .then(() => {
        space();
        return getControlledAccounts()
    })
    .then(() => explain(
        "Each node controls one account which allows it to send and receive Ether. \n" +
        "The private keys reside directly on the evm-babble nodes. In a production \n" +
        "setting, access to the nodes would be restricted to the people allowed to \n" +
        "sign messages with the private key. We also keep a local copy of all the private \n" +
        "keys to demonstrate client-side signing."
    ))

    .then(() => step("STEP 2) Send 500 wei (10^-18 ether) from node1 to node2"))
    .then(() => {
        space();
        return transfer(_demoNodes[0], _demoNodes[1], 500)
    })
    .then(() => explain(
        "We created an EVM transaction to send 500 wei from node1 to node2. The \n" +
        "transaction was sent to node1 which controls the private key for the sender. \n" +
        "EVM-Babble converted the transaction into raw bytes, signed it and submitted \n" +
        "it to Babble for consensus ordering. Babble gossiped the raw transaction to \n" +
        "the other Babble nodes which ran it through the consensus algorithm until they \n" +
        "were each ready to commit it back to EVM-BABBLE. So each node received and \n" +
        "processed the transaction. They each applied the same changes to their local \n" +
        "copy of the ledger."
    ))

    .then(() => step("STEP 3) Check balances again"))
    .then(() => {
        space();
        return getControlledAccounts()
    })
    .then(() => explain("Notice how the balances of node1 and node2 have changed."))

    .then(() => step("STEP 4) Send raw signed transaction"))
    .then(() => {
        space();
        return transferRaw(_demoNodes[2].api, _wallet[0], _wallet[1].address, 500)
    })
    .then(() => explain(
        "We did the same thing as in the previous step but this time, the transaction \n" +
        "was signed locally using javascript utilities and the keys found in the local \n" +
        "keystore. The transaction was sent through node2 which does NOT control the \n" +
        "the private key of the sender. This is to illustrate that the signing took place \n" +
        "on the client side."
    ))

    .then(() => step("STEP 5) Check balances again"))
    .then(() => {
        space();
        return getControlledAccounts();
    })
    .then(() => explain("Notice how the balances of node1 and node2 have changed."))

    .then(() => step("STEP 6) Deploy a Product SmartContract for 1111 wei"))
    .then(() => {
        space();
        return deployContract(_demoNodes[0], _contractFile, 'Product', ["MacBook Pro"])
    })
    .then((contract) => {
        return new Promise((resolve) => {
            _mpContract = contract;
            resolve();
        })
    })
    .then(() => explain(
        "Here we compiled and deployed the Product SmartContract. \n" +
        "The contract was written in the high-level Solidity language which compiles \n" +
        "down to EVM bytecode. To deploy the SmartContract we created an EVM transaction \n" +
        "with a 'data' field containing the bytecode. After going through consensus, the \n" +
        "transaction is applied on every node, so every participant will run a copy of \n" +
        "the same code with the same data."
    ))

    .then(() => step("STEP 7) Make node2 buy product from node1"))
    .then(() => {
        space();
        return buy(_demoNodes[1]);
    })
    .then(() => explain(
        "We created an EVM transaction to call the 'buy' method of the SmartContract. \n" +
        "The operation would fail if the account did not have enough Ether. As an exercise you " +
        "can check that the transaction was run through every Babble node and that node2's " +
        "balance has changed."
    ))
    .then(() => step("STEP 8) Check balances again"))
    .then(() => {
        space();
        return getControlledAccounts();
    })
    .then(() => explain("Notice how the balances of node1 increased and node2 decreased."))

    .catch((err) => log(FgRed, err));

//------------------------------------------------------------------------------

