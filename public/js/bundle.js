(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var app = angular.module('app', []);

require('./controllers/nav')(app);

app.controller('BoardController', function() {
  this.name = "MyBoard"; 
});

module.exports = app;

},{"./controllers/nav":2}],2:[function(require,module,exports){
module.exports = function(app) {
  app.controller('NavigationController', ['$http', function($http) {
    var session = this.session = { loggedIn: false };
    $http.get('/session.json').success(function(data) {
      session.loggedIn = data.auth && data.auth.loggedIn;
    });
  }]);
}

},{}],3:[function(require,module,exports){
var app = require('./app');


},{"./app":1}]},{},[3])