var config    = require('config-url')
  , winston   = require('winston')
  , http      = require('./lib')
  ;

process.on('uncaughtException', function (err) {
  console.error(err.stack || err.toString());
});

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