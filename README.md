# Description
node-ftp-client is a wrapper for the popular FTP client module for [node.js](http://nodejs.org/) - node-ftp, which
provides an easy way of manipulating FTP transfers.


# Requirements

* [node.js](http://nodejs.org/) -- v0.8.0 or newer


# Dependencies

* [node-ftp](https://github.com/mscdex/node-ftp) -- v0.3.6
* [glob](https://github.com/isaacs/node-glob) -- v3.2.9
* [lodash](https://github.com/lodash/lodash-node) -- v2.4.1
* [async](https://github.com/caolan/async) -- v0.8.0

# Installation

    npm install ftp-client

# Usage

## Initialization
To crate an instance of the wrapper use the following code:

```javascript
var ftpClient = require('ftp-client'),
client = new ftpClient(config, options);
```

where `config` contains the ftp server configuration (these are the default values):
```javascript
{
    host: 'localhost',
    port: 21,
    user: 'anonymous',
    password: 'anonymous@'
}
```

and the `options` object may contain the following keys:

* *logging* (String): 'none', 'basic', 'debug' - level of logging for all the tasks - use 'debug' in case of any issues
* *overwrite* (String): 'none', 'older', 'all' - determines which files should be overwritten when downloading/uploading - 'older' compares the date of modification of local and remote files

### Connecting
After creating the new object you have to manually connect to the server by using the `connect` method:
```javascript
client.connect(callback);
```
And passing the callback which should be executed when the client is ready.

## Methods
* **download**(< String > remoteDir, < String > localDir, < Object > options, < Function > callback) - downloads the contents
of `remoteDir` to `localDir` if both exist, and executes the `callback` if one is supplied with the following object as a parameter:
```javascript
{
    downloadedFiles: [(filename)],
    errors: {
        (filename): (error)
    }
}
```
`options` is an object with the following possible keys
    * *overwrite* (String): 'none', 'older', 'all' - determines which files should be overwritten

* **upload**(< mixed > source, < String > remoteDir, < Object > options, < Function > callback) - expands the `source` paths
using the glob module, uploads all found files and directories to the specified `remoteDir` , and executes the `callback`
if one is supplied with the following object as a parameter:
```javascript
{
    uploadedFiles: [(filename)],
    uploadedDirectories: [(dirname)],
    errors: {
        (filename/dirname): (error)
    }
}
```
`source` can be a string or an array of strings, and
`options` is an object with the following possible keys
    * *overwrite* (String): 'none', 'older', 'all' - determines which files should be overwritten
    * *baseDir* (String) - local base path relative to the remote directory, e.g. if you want to upload file
    `uploads/sample.js` to `public_html/uploads`, *baseDir* has to be set to `uploads`

# Examples
In this example we connect to a server, and simultaneously upload all files from the `test` directory, overwriting only
older files found on the server, and download files from `/public_html/test` directory.

```javascript
var ftpClient = require('./lib/client.js'),
    config = {
        host: 'localhost',
        port: 21,
        user: 'anonymous',
        password: 'anonymous@'
    },
    options = {
        logging: 'basic'
    },
    client = new ftpClient(config, options);

client.connect(function () {

    client.upload(['test/**'], '/public_html/test', {
        baseDir: 'test',
        overwrite: 'older'
    }, function (result) {
        console.log(result);
    });

    client.download('/public_html/test2', 'test2/', {
        overwrite: 'all'
    }, function (result) {
        console.log(result);
    });

});
```

TODO
====
* Methods chaining
* Queuing downloads/uploads with async in a single session
* Connecting in constructor, with possibility to end the connection manually