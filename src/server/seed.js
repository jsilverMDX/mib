var Board = require('./models/board');
module.exports = function() {
  Board.find({ id: '1' }, function(err, res) {
    if (err) {
      throw err;
    } else if (res.length === 0) {
      var board = new Board({
        id: "1",
        name: "Default Board",
        columns: [{
          name: "Inbox",
          cards: []
        },{
          name: "Doing",
          cards: []
        },{
          name: "Done",
          cards: []
        }]
      });
      board.save(function(err, res) {
        if (err) throw err;
        else
          console.log(res);
      });
    } else {
      console.log("Default board exists");
    }
  })
}
