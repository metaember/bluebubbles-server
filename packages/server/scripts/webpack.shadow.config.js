const base = require('./webpack.main.prod.config');
module.exports = { ...base, entry: { shadow: './src/shadow-bootstrap.ts' } };
