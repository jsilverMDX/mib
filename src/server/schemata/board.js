module.exports = require('mongoose').Schema({
  id: Number,
  name: String,
  columns: Array,
  links: Object,
  authorizedUsers: Array
});
