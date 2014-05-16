var fs = require('fs'),
    EventEmitter = require('events').EventEmitter,
    inherits = require('util').inherits,
    FTP = require('ftp'),
    _ = require('lodash'),
    glob = require('glob'),
    async = require('async'),
    Client,
    MAX_CONNECTIONS = 10,
    log = function () {
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
        baseDir: '',
        overwrite: 'older' // | 'all' | 'none'
    });

    if (this.options.verbose) {
        log = console.log;
    }

    this.ftp = new FTP();
    this.ftp.on('error', function (err) {
        throw new Error(err);
    });

    this.ftp.on('ready', function () {
        log('Connected to ' + this.config.host);
        log('Checking server local time...');
        this.checkTimezone(function () {
            this.emit('ready');
        }.bind(this));
    }.bind(this));

    this.ftp.connect(config || {});
};

inherits(Client, EventEmitter);

Client.prototype.upload = function (patterns, dest, options, uploadCallback) {
    options = _.defaults(options || {}, this.options);

    var paths, files, dirs, toDelete = [], ftp = this.ftp;

    paths = this.glob(patterns);
    paths = this.clean(paths, options.baseDir);
    paths = this.stat(paths);

    files = paths[1];
    dirs = paths[0];

    var sources = function (array) {
        array.forEach(function (file) {
            log(file.src);
        });
    }

    log('FILES TO UPLOAD');
    sources(files);

    log('DIRS TO UPLOAD');
    sources(dirs);

    var deleteFiles = function (cb) {
            async.eachLimit(toDelete, MAX_CONNECTIONS, function (file, callback) {
                var destPath = (file.src.indexOf(options.baseDir) === 0 ?
                    file.src.substring(options.baseDir.length + 1) : file.src);

                log('Deleting ' + destPath);

                if (file.isDirectory()) {
                    ftp.rmdir(destPath, function (err) {
                        if (err) log(err);
                        callback();
                    }.bind(file));
                } else {
                    ftp.delete(destPath, function (err) {
                        if (err) log(err);
                        callback();
                    }.bind(file));
                }

            }, cb);
        },
        uploadFiles = function (cb) {
            async.eachLimit(files, MAX_CONNECTIONS, function (file, callback) {
                var destPath = (file.src.indexOf(options.baseDir) === 0 ?
                    file.src.substring(options.baseDir.length + 1) : file.src);

                log('Uploading file ' + destPath);

                ftp.put(file.src, destPath, function (err) {
                    if (err) {
                        log(err);
                        this.uploaded = false;
                        this.error = err;
                    } else {
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

                log('Uploading dir ' + destPath);

                ftp.mkdir(destPath, function (err) {
                    if (err) {
                        log(err);
                        this.uploaded = false;
                        this.error = err;
                    } else {
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
                        if (err) log(err);
                        log('Comparing file' + this.src);
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


    this.cwd(dest, function () {
        log('Moved to directory ' + dest);

        var tasks = [];

        // collect files and dirs to be deleted
        tasks.push(function (callback) {
            log('1. Compare files');
            return compare(function (err) {
                if (err) log(err);
                log('FILES TO DELETE');
                sources(toDelete);
                callback();
            }.bind(this));
        }.bind(this));

        // delete files and dirs
        tasks.push(function (callback) {
            log('2. Delete files');
            return deleteFiles(function (err) {
                if (err) log(err);
                callback();
            }.bind(this));
        }.bind(this));

        // upload dirs
        tasks.push(function (callback) {
            log('3. Upload dirs');
            return uploadDirs(function (err) {
                if (err) log(err);
                else log('Uploaded dirs');
                callback();
            }.bind(this));
        }.bind(this));

        // upload files
        tasks.push(function (callback) {
            log('4. Upload files');
            return uploadFiles(function (err) {
                if (err) log(err);
                else log('Uploaded files');
                callback();
            }.bind(this));
        }.bind(this));

        async.series(tasks, function (err) {
            if (err) throw err;
            ftp.end();
            log('Upload done');
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
            uploadCallback(result);
        });
    }.bind(this));
}

Client.prototype.download = function (files, dest, options) {
    options = _.defaults(options || {}, this.options);

    log('download files', files, options);
}

Client.prototype.cwd = function (path, callback) {
    this.ftp.mkdir(path, true, function (err) {
        if (err) log(err);
        this.ftp.cwd(path, function (err) {
            if (err) log(err);
            callback();
        });
    }.bind(this));
}

Client.prototype.checkTimezone = function (cb) {
    var localTime = new Date().getTime(),
        serverTime,
        ftp = this.ftp;

    async.series([
        function (next) {
            return ftp.put(new Buffer(''), '.timestamp', function (err) {
                if (err) log(err);
                next();
            });
        },
        function (next) {
            return ftp.list('.timestamp', function (err, list) {
                if (err) log(err);
                if (list && list[0] && list[0].date) {
                    serverTime = list[0].date.getTime();
                }
                next();
            });
        },
        function (next) {
            return ftp.delete('.timestamp', function (err) {
                if (err) log(err);
                next();
            });
        }
    ], function () {
        this.serverTimeDif = localTime - serverTime;
        log('Server time is ', new Date(new Date().getTime() - this.serverTimeDif));
        cb();
    }.bind(this));
}

Client.prototype.glob = function (patterns) {
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

Client.prototype.stat = function (files) {
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

Client.prototype.clean = function (files, baseDir) {
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