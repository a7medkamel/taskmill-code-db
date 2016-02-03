var express     = require('express')
  , Promise     = require('bluebird')
  , bodyParser  = require('body-parser')
  , Repository  = require('./git/repository')
  ;

var app = express();

app.use(bodyParser.json());

app.post('/findOne', function(req, res, next){
  var remote    = req.body.remote   || 'https://github.com/a7medkamel/taskmill-core-agent.git'
    , branch    = req.body.branch   || 'master' // todo [akamel] not used
    , filename  = req.body.filename || 'lib/core/worker.js'
    , token     = req.body.token
    ;

  var repo = Repository.get(remote, token);

  repo.updatedAt()
        .then((at) => {
          console.log('at', repo.id, at);
          if (!at) {
            return repo.pull();
          }
        })
        .then(() => {
          return repo
                  .readFile(filename)
                  .then((data) => {
                    res.send(data);
                  });
        })
        .catch(function(err){
          console.error(err);
          res.status(400).send({
            message : err.message
          });
        });
});

app.post('/info', function(req, res, next){
  var remote    = req.body.remote
    , token     = req.body.token
    ;

  var repo = Repository.get(remote, token);

  repo.info()
        .then((data) => {
          res.send(data);
        })
        .catch(function(err){
          console.error(err, err.stack);
          res.status(400).send({
            message : err.message
          });
        });
});

function listen(options, cb) {
    Promise
      .promisify(app.listen, { context : app})(options.port)
      .tap(function(){
      console.log('codedb started and listeing to:', options.port);
    })
    .nodeify(cb);
}

module.exports = {
    listen : listen
};