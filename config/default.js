var bytes = require('bytes')
  , ms    = require('ms')
  , fs    = require('fs')
  ;

module.exports = {
  "codedb" : {
    "file_size_limit"   : bytes('10kb'),
    "ttl"               : ms('10m'),
    "git-crypt"         : {
      "key"         : fs.readFileSync('./key/pgp.asc', 'utf-8'),
      "passphrase"  : fs.readFileSync('./key/pgp.passphrase', 'utf-8')
    }
  }
};
