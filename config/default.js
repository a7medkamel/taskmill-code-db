var bytes = require('bytes')
  , ms    = require('ms')
  ;

module.exports = {
  "codedb" : {
    "file_size_limit"   : bytes('10kb'),
    "ttl"               : ms('10m')
  }
};
