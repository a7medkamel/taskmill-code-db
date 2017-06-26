"use strict";

var Promise       = require('bluebird')
  , _             = require('lodash')
  , mime          = require('mime-types')
  , marked        = require('marked')
  , babel         = require('babel-core')
  // , url_join      = require('url-join')
  , dot           = require('dotparser')
  , man           = require('taskmill-core-man')
  , git           = require('taskmill-core-git')
  , Repository    = require('../git/repository')
  ;

class Blob {
  constructor(remote, filename, options = {}) {
    let { branch, text } = options;

    this.text       = text;
    this.branch     = branch;
    this.remote     = remote;
    this.filename   = filename;

    this.mime_type  = mime.lookup(filename);
  }

  metadata(fields = {}) {
    let ret = {};

    switch(this.mime_type) {
      case 'application/javascript':
      ret = Blob.metadata_js(this.text, fields);
      break;
      case 'text/x-markdown':
      ret = Blob.metadata_md(this.text, fields);
      break;
    }

    return ret;
  }

  static metadata_js(text, fields = {}) {
    let ret = {};

    if (fields.ast || fields.manual || fields.es5) {
      try {
        let es6 = babel.transform(text); // => { code, map, ast }

        if (fields.ast) {
          ret.ast = es6.ast;
        }

        if (fields.manual) {
          ret.manual = man.get(es6);
        }

        if (fields.es5) {
          ret.es5 = es6.code;
        }
      } catch(err) {}
    }

    return ret;
  }

  static metadata_md(text, fields = {}) {
    let ret = {
      markdown : {
        options : { gfm : true }
      }
    };

    if (fields.ast || fields.block) {
      try {
        let ast = marked.lexer(text, ret.markdown.options);

        if (fields.ast) {
          ret.ast = ast;
        }

        if (fields.block) {
          ret.block = _.chain(ast)
                        .map((b) => {
                          try {
                            if (b.type == 'code') {
                              switch(b.lang) {
                                case 'dot':
                                return { type : 'dot', text : b.text, dot : dot(b.text) };
                                default:
                                return _.extend({ type : 'js', text : b.text }, Blob.metadata_js(b.text, { manual : fields.manual }));
                              }
                            }
                          } catch(err) {}
                        })
                        .reject(_.isEmpty)
                        .value();

        }
      } catch(err) {}
    }

    return ret;
  }
}

module.exports = Blob;
