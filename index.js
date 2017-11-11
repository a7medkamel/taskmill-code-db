var config    = require('config-url')
  , winston   = require('winston')
  , Promise   = require('bluebird')
  , http      = require('./lib')
  ;

Promise.longStackTraces();

process.on('uncaughtException', function (err) {
  winston.error(err);
});

winston.level = config.get('codedb.winston');

function main() {
  return http
          .listen({ port : config.getUrlObject('codedb').port })
          .then(() => {
            winston.info('taskmill-core-codedb [started] :%d', config.getUrlObject('codedb').port);
          });
}

if (require.main === module) {
  main();
}

module.exports = {
  main  : main
};
