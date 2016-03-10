var config    = require('config')
  , winston   = require('winston')
  , http      = require('./lib')
  ;

process.on('uncaughtException', function (err) {
  console.error(err.stack || err.toString());
});

function main() {
  http.listen({ port : config.get('codedb.port') }, () => {
    winston.info('taskmill-core-codedb [started] :%d', config.get('codedb.port'));
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  main  : main
};