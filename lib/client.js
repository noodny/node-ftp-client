var fs = require('fs'),
    EventEmitter = require('events').EventEmitter,
    inherits = require('util').inherits,
    Client;

Client = module.exports = function () {
    if (!(this instanceof Client))
        return new Client();

};
inherits(Client, EventEmitter);

Client.prototype = {}