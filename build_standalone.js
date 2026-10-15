const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

let standalone = html.replace('<link rel="stylesheet" href="style.css">', `<style>\n${css}\n</style>`);
standalone = standalone.replace('<script src="app.js"></script>', `<script>\n${js}\n</script>`);

fs.writeFileSync(path.join(__dirname, 'mindmap_standalone.html'), standalone, 'utf8');
console.log('Successfully created mindmap_standalone.html');
