var config    = require('config-url')
  , winston   = require('winston')
  , Promise   = require('bluebird')
  , http      = require('./lib')
  ;

Promise.config({
  longStackTraces: true
})

process.on('uncaughtException', (err) => {
  console.error('unhandled:exception', err);
});

process.on('unhandledRejection', (reason, p) => {
  console.error('unhandled:rejection', err, p);
});

winston.level = config.get('codedb.winston');

function main() {
  return http
          .listen({ port : config.getUrlObject('codedb').port })
          .then(() => {
            winston.info('taskmill-core-codedb [started] :%d', config.getUrlObject('codedb').port);
          })
          .catch((err) => {
            winston.error('boot failed', err);
          });
}

if (require.main === module) {
  main();
}

module.exports = {
  main  : main
};
