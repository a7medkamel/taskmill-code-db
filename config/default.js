var bytes = require('bytes')
  , ms    = require('ms')
  ;

module.exports = {
  "codedb" : {
    "file_size_limit"   : bytes('10kb'),
    "git_archive_limit" : bytes('5mb'),
    "ttl"               : ms('10m')
  }
};
