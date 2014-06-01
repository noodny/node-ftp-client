var fs = require('fs'),
    EventEmitter = require('events').EventEmitter,
    inherits = require('util').inherits,
    FTP = require('ftp'),
    _ = require('lodash'),
    glob = require('glob'),
    async = require('async'),
    Client,
    MAX_CONNECTIONS = 10,
    logging = 'basic',
    loggingLevels = ['none', 'basic', 'debug'],
    log = function (msg, lvl) {
        if (loggingLevels.indexOf(lvl) <= logging) {
            console.log(msg);
        }
    };

Client = module.exports = function (config, options) {
    if (!(this instanceof Client))
        return new Client();

    this.config = _.defaults(config || {}, {
        host: 'localhost',
        port: 21,
        user: 'anonymous',
        password: 'anonymous@'
    });

    this.options = _.defaults(options || {}, {
        overwrite: 'older' // | 'all' | 'none'
    });

    if (this.options.logging) {
        logging = this.options.logging;
        logging = loggingLevels.indexOf(logging);
    }

    this.ftp = new FTP();
    this.ftp.on('error', function (err) {
        throw new Error(err);
    });
};

inherits(Client, EventEmitter);

Client.prototype.connect = function (callback) {
    this.ftp.on('ready', function () {
        log('Connected to ' + this.config.host, 'debug');
        log('Checking server local time...', 'debug');
        this._checkTimezone(function () {
            this.emit('ready');
            if (typeof callback !== 'undefined') {
                callback();
            }
        }.bind(this));
    }.bind(this));

    this.ftp.connect(this.config || {});
};

Client.prototype.upload = function (patterns, dest, options, uploadCallback) {
    options = _.defaults(options || {}, this.options);

    var paths, files, dirs, toDelete = [], ftp = this.ftp;

    paths = this._glob(patterns);
    paths = this._clean(paths, options.baseDir);
    paths = this._stat(paths);

    files = paths[1];
    dirs = paths[0];

    var sources = function (array) {
        array.forEach(function (file) {
            log(file.src, 'debug');
        });
    }

    log('FILES TO UPLOAD', 'debug');
    sources(files);

    log('DIRS TO UPLOAD', 'debug');
    sources(dirs);

    var deleteFiles = function (cb) {
            async.eachLimit(toDelete, MAX_CONNECTIONS, function (file, callback) {
                var destPath = (file.src.indexOf(options.baseDir) === 0 ?
                    file.src.substring(options.baseDir.length + 1) : file.src);

                log('Deleting ' + destPath, 'debug');

                if (file.isDirectory()) {
                    ftp.rmdir(destPath, function (err) {
                        if (err) log(err, 'debug');
                        callback();
                    }.bind(file));
                } else {
                    ftp.delete(destPath, function (err) {
                        if (err) log(err, 'debug');
                        callback();
                    }.bind(file));
                }

            }, cb);
        },
        uploadFiles = function (cb) {
            async.eachLimit(files, MAX_CONNECTIONS, function (file, callback) {
                var destPath = (file.src.indexOf(options.baseDir) === 0 ?
                    file.src.substring(options.baseDir.length + 1) : file.src);

                log('Uploading file ' + destPath, 'debug');

                ftp.put(file.src, destPath, function (err) {
                    if (err) {
                        log('Error uploading file ' + destPath + ': ' + err, 'basic');
                        this.uploaded = false;
                        this.error = err;
                    } else {
                        log('Finished uploading file ' + destPath, 'basic');
                        this.uploaded = true;
                    }
                    callback();
                }.bind(file));
            }, cb);
        },
        uploadDirs = function (cb) {
            async.eachLimit(dirs, MAX_CONNECTIONS, function (dir, callback) {
                var destPath = (dir.src.indexOf(options.baseDir) === 0 ?
                    dir.src.substring(options.baseDir.length + 1) : dir.src);

                log('Uploading directory ' + destPath, 'debug');

                ftp.mkdir(destPath, function (err) {
                    if (err) {
                        log('Error uploading directory ' + destPath + ': ' + err, 'basic');
                        this.uploaded = false;
                        this.error = err;
                    } else {
                        log('Finished uploading directory ' + destPath, 'basic');
                        this.uploaded = true;
                    }
                    callback();
                }.bind(dir))
            }, cb);
        },
        compare = function (cb) {
            var timeDif = this.serverTimeDif;
            if (options.overwrite === 'all') {
                toDelete = files.concat(dirs);
                cb();
            } else {
                async.eachLimit(files.concat(dirs), MAX_CONNECTIONS, function (file, callback) {
                    var destPath = (file.src.indexOf(options.baseDir) === 0 ?
                        file.src.substring(options.baseDir.length + 1) : file.src);

                    ftp.list(destPath, function (err, list) {
                        if (err) log(err, 'debug');
                        log('Comparing file' + this.src, 'debug');
                        if (list && list[0]) {
                            if (options.overwrite === 'older' && list[0].date && new Date(list[0].date.getTime() + timeDif) < this.mtime) {
                                toDelete.push(this);
                            } else {
                                if (this.isDirectory()) {
                                    dirs.forEach(function (dir, i) {
                                        if (dir.src === this.src) {
                                            dirs.splice(i, 1);
                                        }
                                    }.bind(this))
                                } else {
                                    files.forEach(function (file, i) {
                                        if (file.src === this.src) {
                                            files.splice(i, 1);
                                        }
                                    }.bind(this))
                                }
                            }
                        }
                        callback();
                    }.bind(file))
                }, cb);
            }
        }.bind(this)


    this._cwd(dest, function () {
        log('Moved to directory ' + dest, 'debug');

        var tasks = [];

        // collect files and dirs to be deleted
        tasks.push(function (callback) {
            log('1. Compare files', 'debug');
            return compare(function (err) {
                if (err) log(err, 'debug');
                log('FILES TO DELETE', 'debug');
                sources(toDelete);
                log('Found ' + files.length + ' files and ' + dirs.length + ' directories to upload.', 'basic');
                callback();
            }.bind(this));
        }.bind(this));

        // delete files and dirs
        tasks.push(function (callback) {
            log('2. Delete files', 'debug');
            return deleteFiles(function (err) {
                if (err) log(err, 'debug');
                callback();
            }.bind(this));
        }.bind(this));

        // upload dirs
        tasks.push(function (callback) {
            log('3. Upload dirs', 'debug');
            return uploadDirs(function (err) {
                if (err) log(err, 'debug');
                else log('Uploaded dirs', 'debug');
                callback();
            }.bind(this));
        }.bind(this));

        // upload files
        tasks.push(function (callback) {
            log('4. Upload files', 'debug');
            return uploadFiles(function (err) {
                if (err) log(err, 'debug');
                else log('Uploaded files', 'debug');
                callback();
            }.bind(this));
        }.bind(this));

        async.series(tasks, function (err) {
            if (err) throw err;
            ftp.end();
            log('Upload done', 'debug');
            var result = {
                uploadedFiles: [],
                uploadedDirs: [],
                errors: {}
            }
            dirs.forEach(function (dir) {
                if (dir.uploaded) {
                    result.uploadedDirs.push(dir.src);
                } else {
                    result.errors[dir.src] = dir.error;
                }
            });
            files.forEach(function (file) {
                if (file.uploaded) {
                    result.uploadedFiles.push(file.src);
                } else {
                    result.errors[file.src] = file.error;
                }
            })
            log('Finished uploading ' + result.uploadedFiles.length + ' of ' + files.length + ' files.', 'basic');
            uploadCallback(result);
        });
    }.bind(this));
}

Client.prototype.download = function (source, dest, options, downloadCallback) {
    options = _.defaults(options || {}, this.options);

    if (!fs.existsSync(dest)) {
        this.ftp.end();
        throw new Error('The download destination directory ' + dest + ' does not exist.');
    }

    var ftp = this.ftp;
    var timeDif = this.serverTimeDif;

    var files = {}, dirs = [];
    var queue = async.queue(function (task, callback) {
        log('Queue worker started for ' + task.src, 'debug');
        ftp.list(task.src, function (err, list) {
            if (err || typeof list === 'undefined' || typeof list[0] === 'undefined') {
                throw new Error('The source directory on the server ' + task.src + ' does not exist.');
            }

            if (list && list.length > 1) {
                _.each(list.splice(1, list.length - 1), function (file) {
                    if (file.name !== '.' && file.name !== '..') {
                        var filename = task.src + '/' + file.name;
                        if (file.type === 'd') {
                            dirs.push(filename);
                            queue.push({src: filename}, function (err) {
                                if (err) log(err, 'debug');
                            });
                        } else if (file.type === '-') {
                            files[filename] = {
                                date: file.date
                            };
                        }
                    }
                });
            }

            callback();
        });
    }, MAX_CONNECTIONS);

    queue.drain = function () {
        log([dirs, files], 'debug');

        dirs.forEach(function (dir) {
            var dirName = dest + '/' + (dir.indexOf(source) === 0 ? dir.substring(source.length + 1) : dir);
            if (!fs.existsSync(dirName)) {
                fs.mkdirSync(dirName);
                log('Created directory ' + dirName, 'debug');
            }
        });

        var toDelete = [], result = {
            downloadedFiles: [],
            errors: {}
        };

        if (options.overwrite === 'all') {
            toDelete = _.keys(files);
        }

        if (options.overwrite === 'older') {
            var skip = [];

            _.each(files, function (details, file) {
                var fileName = file.replace(source, dest);
                log('Comparing file ' + fileName, 'debug');

                if (fs.existsSync(fileName)) {
                    var stat = fs.statSync(fileName);

                    if (stat.mtime.getTime() < details.date.getTime() + timeDif) {
                        toDelete.push(fileName);
                    } else {
                        skip.push(file);
                    }
                }
            });

            skip.forEach(function (file) {
                delete files[file];
            });
        }

        if (options.overwrite === 'none') {
            var skip = [];
            _.each(files, function (details, file) {
                var fileName = file.replace(source, dest);

                if (fs.existsSync(fileName)) {
                    skip.push(file);
                }
            });

            skip.forEach(function (file) {
                delete files[file];
            });
        }

        toDelete.forEach(function (file) {
            try {
                fs.unlinkSync(file.replace(source, dest));
            } catch (e) {

            }
        });

        log('Found ' + _.keys(files).length + ' files to download.', 'basic');

        async.forEachLimit(_.keys(files), MAX_CONNECTIONS, function (file, callback) {
            log('Downloading file ' + file, 'debug');

            ftp.get(file, function (err, stream) {
                if (err && err.message !== 'Unable to make data connection') {
                    log('Error downloading file ' + file, 'basic');
                    result['errors'][file] = err;
                }
                if (stream) {
                    stream.once('close', function () {
                        log('Finished downloading file ' + file, 'basic');
                        result['downloadedFiles'].push(file);
                        callback();
                    });
                    stream.pipe(fs.createWriteStream(file.replace(source, dest)));
                }
            });
        }, function (err) {
            if (err) return next(err);
            if (downloadCallback) {
                downloadCallback(result);
            }
            log('Finished downloading ' + result.downloadedFiles.length + ' of ' + _.keys(files).length + ' files', 'basic');
            ftp.end();
        });

        log(['To delete: ', toDelete], 'debug');
        log(['To download: ', files], 'debug');
    }

    queue.push({src: source}, function (err) {
        if (err) log(err, 'debug');
    });

    // 1. check if directory exists
    // 2. if not throw an error
    // 3. if it does - build a list of directories and files using async.queue
    // 4. download all the files from the list

}

Client.prototype._cwd = function (path, callback) {
    this.ftp.mkdir(path, true, function (err) {
        if (err) log(err, 'debug');
        this.ftp.cwd(path, function (err) {
            if (err) log(err, 'debug');
            callback();
        });
    }.bind(this));
}

Client.prototype._checkTimezone = function (cb) {
    var localTime = new Date().getTime(),
        serverTime,
        ftp = this.ftp;

    async.series([
        function (next) {
            return ftp.put(new Buffer(''), '.timestamp', function (err) {
                if (err) log(err, 'debug');
                next();
            });
        },
        function (next) {
            return ftp.list('.timestamp', function (err, list) {
                if (err) log(err, 'debug');
                if (list && list[0] && list[0].date) {
                    serverTime = list[0].date.getTime();
                }
                next();
            });
        },
        function (next) {
            return ftp.delete('.timestamp', function (err) {
                if (err) log(err, 'debug');
                next();
            });
        }
    ], function () {
        this.serverTimeDif = localTime - serverTime;
        log('Server time is ' + new Date(new Date().getTime() - this.serverTimeDif), 'debug');
        cb();
    }.bind(this));
}

Client.prototype._glob = function (patterns) {
    var include = [],
        exclude = [];

    if (!_.isArray(patterns)) {
        patterns = [patterns];
    }

    patterns.forEach(function (pattern) {
        if (pattern.indexOf('!') === 0) {
            exclude = exclude.concat(glob.sync(pattern.substring(1), {nonull: false}) || []);
        } else {
            include = include.concat(glob.sync(pattern, {nonull: false}) || []);
        }
    });

    return _.difference(include, exclude);
}

Client.prototype._stat = function (files) {
    var result = [
        [],
        []
    ];
    _.each(files, function (file) {
        file = _.extend(fs.statSync(file), {src: file});
        if (file.isDirectory()) {
            result[0].push(file);
        } else {
            result[1].push(file);
        }
    });
    return result;
}

Client.prototype._clean = function (files, baseDir) {
    if (!baseDir) {
        return files;
    }

    return _.compact(_.map(files, function (file) {
        if (file.replace(baseDir, '')) {
            return file;
        } else {
            return null;
        }
    }));
}