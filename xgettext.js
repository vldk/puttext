#!/usr/bin/env node

var path = require('path'),
    fs = require('fs'),
    parsers = require('./parsers'),
    Getopt = require('node-getopt'),
    U = require('uglify-js');

function check(node, markers) {
    if (!(node instanceof U.AST_Call)) {
        return false;
    }

    for (var i = 0; i < markers.length; i++) {
        var m = markers[i].split('.');
        if (node.start.value === m[0] &&
            node.expression.end.value === m[m.length - 1] &&
            //skip call without any args, like __();
            node.args.length) {
            return true;
        }
    }

    return false;
}


function extract(fn, markers) {
    var ast, code, results, visitor, walker, parser;
    results = [];

    visitor = function(node, descend) {
        if (!check(node, markers)) {
            return;
        }

        var a = node.args;
        var entry = [["#: " + fn + ":" + node.start.line]];

        if (a.length > 1 && typeof a[1].value === 'string') {
            entry.push([a[0].value, a[1].value]);
        } else {
            entry.push(a[0].value);
        }


        a[0].start.comments_before.forEach(function (_node) {
            entry[0].push('#. ' + _node.value);
        });


        results.push(entry);
    };

    parser = path.extname(fn).substr(1).toUpperCase();
    code = parsers[parser](fs.readFileSync(fn).toString());

    try {
        ast = U.parse(code);
    } catch (e) {
        console.log(fn);
        throw e;
    }

    walker = new U.TreeWalker(visitor);
    ast.walk(walker);
    return results;
}

/**
 *
 * @param filepath
 * @param callback
 * @returns {Array}
 */
function walkSync(filepath, callback) {
    try {
        if (fs.statSync(filepath).isDirectory()) {
            return fs.readdirSync(filepath).map(function(fn) {
                return walkSync(path.join(filepath, fn), callback);
            });
        } else if (path.extname(filepath).substr(1).toUpperCase() in parsers) {
            return callback(null, filepath);
        } else {
            return [];
        }

    } catch (err){
        return callback(err);
    }
}


function format(s, ctx) {
    return s.replace(/\{([^\}]+)\}/g, function(match, k) {
        return ctx[k];
    });
}

function e(s) {
    return JSON.stringify(s);
}

function format_msgid(data) {
    data = extract_comments(data)
    if (typeof data.m === 'string') {
        return format(data.c + 'msgid {msg}\nmsgstr ""\n',
                           {msg: e(data.m)});
    }
    return format(data.c + 'msgid {one}\nmsgid_plural {two}\n' +
                  'msgstr[0] ""\nmsgstr[1] ""\n',
                  {one: e(data.m[0]), two: e(data.m[1])});
}

function extract_comments(msg) {
    var comments = []

    msg = [].concat(msg).map(function(m) {
        return m.replace(/\{([^\}]+)\}/g, function(_, k) {
            k = k.split('#').map(eval.call, ''.trim)
            if (k[1]) {
                comments.push('#. ' + k[0] + ' - ' + k[1] + '\n')
            }
            return '{' + k[0] + '}'
        })
    })

    return {
        c: comments.join(''),
        m: msg[1] ? msg : msg[0]
    }
}

var uniq = {},
    toString$ = ({}).toString;

function process_main(fn, markers) {
    if (!markers || !markers.length) {
        markers = ['__'];
    }

    // print minimal sufficient header
    console.log(
        'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n');



    walkSync(fn, function(err, fn) {
        if(err){
            console.log(err);
            return;
        }

        return extract(fn, markers);
    }).forEach(function (file_messages) {
        if(!file_messages.length){
            return;
        }

        var msg, comment, _key;

        for (var i = 0; i < file_messages.length; i++) {
            //comment is an array
            comment = file_messages[i][0];
            msg = file_messages[i][1];

            // hard stop if we received something strange
            if (msg === undefined) {
                console.log("ERROR: something went wrong in " + fn);
                process.exit(1);
            }

            // output message string
            _key = toString$.call(msg).slice(8,-1) === "Array" ? msg.join("|") : msg;
            if(!uniq.hasOwnProperty(_key)){
                uniq[_key] = {
                    comment: comment,
                    msg: msg
                };
            }
            //process duplicates,
            else {
                uniq[_key].comment = [].concat(uniq[_key].comment, comment).sort().reverse();
            }
        }
    });

    for(var _key in uniq){
        console.log(uniq[_key].comment.join("\n"));
        console.log(format_msgid(uniq[_key].msg));
    }


}

function run() {
    var getopt = new Getopt([
        ['m', 'marker=ARG+',
         'function name identifying a translatable string (default: __)'],
        ['h', 'help', 'display this help']
    ]).bindHelp();

    var opt = getopt.parseSystem();

    if (!opt.argv.length) {
        return getopt.showHelp();
    }

    process_main(opt.argv[0], opt.options.marker);
}

run();
