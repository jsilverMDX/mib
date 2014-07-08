var express = require('express');
var r = module.exports = express.Router();
var _ = require('lodash');
var logger = require('winston');
var Promise = require('bluebird');

var Models = require('./models'),
Board = Models.Board,
Column = Models.Column,
Card = Models.Card,
User = Models.User;

var providers = require('../providers');

/*
 * GET /session -- get your user session
 * POST /session -- get your token
 */

r.route('/session')
.get(loginRequired, getSession)
.post(createSession);

function loginRequired(req, res, next) {
  var token = req.headers['x-auth-token'] || req.query.token;
  if (token) {
    User.findOne({ token: token }).exec(function (err, user) {
      if (err) {
        logger.error(err.message)
        res.send(500)
      } else if (user) {
        req.user = user;
        next();
      } else {
        logger.warn("loginRequired 401 -- no user found with token "+token);
        res.send(401);
      }
    })
  } else {
    logger.warn("loginRequired 401 -- no token provided");
    res.send(401)
  }
};


function getSession(req, res, next) {
  res.send(req.user);
};

function createSession(req, res, next) {
  User.findOrCreateByAuthorization(req.body, providers, function (err, user) {
    if (err) {
      res.send(401);
    } else {
      res.send(201, { token: user.token, _id: user._id });
    }
  });
}

/*
 * GET /boards
 * POST /boards
 */

r.route('/boards')
.all(loginRequired)
.get(myBoards)
.post(createBoard);

function myBoards(req, res, next) {
  Board.find({ authorizedUsers: req.user._id }, { name:1 }, function (err, boards) {
    if (err) { res.send(500) }
    else { res.send({boards: boards}) }
  });
};

function createBoard(req, res, next) {
  if (req.body.jsonImport) {
    res.send(500, 'Not yet implemented');
  } else {
    Board.createWithDefaultColumns({
      name: req.body.name,
      authorizedUsers: [req.user._id]
    }).then(function (board) {
      res.send(201, { board: { _id: board._id }});
    }).catch(function (err) {
      logger.error(err.message);
      res.send(500);
    });
  }
};


/*
 * GET /boards/:_id
 */

r.route('/boards/:_id')
.all(loginRequired)
.all(initializeBoard)
.get(getBoard)
.delete(deleteBoard);

function initializeBoard(req, res, next) {
  Board.findOneAndPopulate({ _id: req.params._id }).then(function (board) {
    req.board = board;
    next();
  }).error(function () {
    res.send(404);
  }).catch(Error, function (err) {
    logger.error(err.message);
    res.send(500);
  })
};

function getBoard(req, res, next) {
  res.send({ board: req.board });
}

function deleteBoard(req, res, next) {
  req.board.remove(function(err) {
    if (err) {
      logger.error(err.message);
      res.send(500)
    } else {
      res.send(204);
    }
  });
}

/*
 * PUT /boards/:_id/links/:provider
 * Link a board with remote objects (e.g. repositories) from a provider
 */

r.route('/boards/:_id/links/:provider')
.all(loginRequired)
.all(initializeBoard)
.put(updateBoardLinks);

function updateBoardLinks(req, res, next) {
  var board = req.board;
  if (! board.links ) {
    board.links = {};
  }
  if (! board.links[req.params.provider]) {
    board.links[req.params.provider] = {}
  }
  _.each(req.body[req.params.provider], function (repo) {
    board.links[req.params.provider][repo.id] = repo;
  });
  Board.update({ _id: board._id }, { links: board.links }, function(err) {
    if (err) { res.send(500, err.message); }
    else { res.send({ links: board.links }) }
  });
};

/*
 * POST /boards/:id/cards/:provider
 * Import cards into the board using the provider
 */

r.route('/boards/:_id/cards/:provider')
.post(loginRequired,
      initializeBoard,
      initializeFirstColumn,
      initializeCardHandler,
      importCardsViaProvider,
      saveCardsViaPromises,
      initializeBoard,
      sendBoardColumns);

function initializeFirstColumn(req, res, next) {
  Column.findOne({ board: req.board._id, role: 1 })
  .exec(function (err, column) {
    if (err) {
      logger.error(err.message);
      res.send(500);
    } else {
      req.column = column;
      next();
    }
  });
};

function initializeCardHandler(req, res, next) {
  req.handler = providers[req.params.provider].cardHandler;
  next();
};

function importCardsViaProvider(req, res, next) {
  req.promises = [];
  req.handler.batchImport(req.board, req.body, function (attributes) {
    attributes.column = req.column._id;
    req.promises.push(Card.create(attributes))
  }, next);
};

function saveCardsViaPromises(req, res, next) {
  Promise.all(req.promises).then(function () {
    req.board.update({ columns: req.board.columns }, function(err) {
      if (err) res.send(500, err.message);
      else next()
    });
  });
};

function sendBoardColumns(req, res, next) {
  res.send({ board: { columns: req.board.columns } });
};

/*
 * PUT /boards/:id/cards/:card_id/move
 * Move cards around within columns and/or across columns
 */

r.route('/boards/:_id/cards/:card_id/move')
.put(loginRequired,
     initializeBoard,
     performCardMove);

function performCardMove(req, res, next) {
  if (req.body.old_column === req.body.new_column) {
    Column.findByIdAndMutate(req.body.old_column, function (column) {
      column.cards.splice(column.cards.indexOf(req.params.card_id), 1);
      column.cards.splice(req.body.new_index, 0, req.params.card_id);
    }).then(function () {
      res.send(204)
    }).catch(function (err) {
      logger.error(err.message);
      res.send(500)
    });
  } else {
    Promise.all([
      Column.findByIdAndMutate(req.body.old_column, function (column) {
        column.cards.splice(column.cards.indexOf(req.params.card_id), 1);
      }),
      Column.findByIdAndMutate(req.body.new_column, function (column) {
        column.cards.splice(req.body.new_index, 0, req.params.card_id);
      })
    ]).then(function () {
      res.send(204)
    }).catch(function (err) {
      logger.error(err.message);
      res.send(500)
    });
  }
};

/*
 * GET /boards/:id/export.json
 * Export an entire board as human and machine readable JSON
 */

// TODO regression test
r.route('/boards/:_id/export.json')
.get(loginRequired,
     initializeBoard,
     exportBoardAsJSON);

function exportBoardAsJSON(req, res, next) {
  var beautify = require('js-beautify').js_beautify;
  output = beautify(JSON.stringify(req.board), { indent_size: 2 });
  res.set("Content-Disposition", 'attachment; filename="'+req.board.name+'.json"');
  res.send(output);
};

/*
 * PUT /boards/:id/users
 * Update a board's authorized users list
 */

// TODO regression test
r.route('/boards/:_id/authorizedUsers/:user_id')
.all(loginRequired, initializeBoard)
.post(addAuthorizedUser)
.delete(removeAuthorizedUser);

function addAuthorizedUser(req, res, next) {
  var ObjectId = require('mongoose').Types.ObjectId; 
  try {
    var user_id = ObjectId(req.params.user_id);
    if (req.board.authorizedUsers.indexOf(user_id) >= 0) {
      res.send(400, 'user already authorized');
    } else {
      req.board.authorizedUsers.push(user_id);
      req.board.save(function(err, board) {
        if (err) { res.send(500, err.message); }
        else { res.send({ authorizedUsers: board.authorizedUsers }) }
      });
    }
  } catch (err) {
    logger.error('addAuthorizedUser 400', err.message);
    res.send(400, err.message);
  }
};

function removeAuthorizedUser(req, res, next) {
  var ObjectId = require('mongoose').Types.ObjectId; 
  try {
    var user_id = ObjectId(req.params.user_id);
    var index = req.board.authorizedUsers.indexOf(user_id);
    if (index >= 0) {
      req.board.authorizedUsers.splice(index, 1);
      req.board.save(function(err, board) {
        if (err) { res.send(500, err.message); }
        else { res.send({ authorizedUsers: board.authorizedUsers }) }
      });
    } else {
      res.send(404, 'user not authorized');
    }
  } catch (err) {
    logger.error('removeAuthorizedUser 400', err.message);
    res.send(400, err.message);
  }
};



/*
 *
 * ALL CODE BELOW IS PRE-REFACTOR
 *
 */


var findCardPosition = function (board, issue, cb) {
  var col, row, card, column = null;
  if (_.find(board.columns, function (column, i) {
    col = i;
    return _.find(column.cards, function (c, j) {
      row = j;
      card = c
      return card.remoteObject.id == issue.id;
    })
  })) { 
    cb(null, col, row);
  } else {
    cb(new Error("Card not found"));
  }
};

// FIXME secure this route https://developer.github.com/webhooks/securing/
r.post('/boards/:_id/:provider/:repo_id/webhook', function(req, res, next) {
  Board.find({ _id: req.params._id }, function(err, boards) {
    if (err) {
      res.send(500);
    } else if (boards.length === 0) {
      res.send(404);
    } else {
      var handler = providers[req.params.provider].cardHandler;
      var action = req.body.action;
      var board = boards[0];
      var persistColumns = function() {
        Board.update({ _id: board._id }, { columns: board.columns }, function(err) {
          if (err) { res.send(500, err.message); }
          else { res.send(204) }
        });
      }
      if (req.body.action === "opened") {
        var card = handler.newCard(req.params.repo_id, req.body.issue);
        board.columns[0].cards.push(card)
        persistColumns();
      } else if (action === "created" || action === "closed" || action === "reopened") {
        // TODO closed move to last column, reopened move to first column
        findCardPosition(board, req.body.issue, function (err, col, row) {
          if (err) { res.send(404) } else { 
            var card = board.columns[col].cards[row];
            card.remoteObject = req.body.issue;
            persistColumns();
          }
        })
      } else {
        res.send(204)
      }
    }
  })
});

