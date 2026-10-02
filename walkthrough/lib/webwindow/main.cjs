// A frameless, see-through window showing one web page: for props on a recorded desktop (a phone
// screen), which should look like objects on the desktop rather than browser windows.
// Arguments: --url=… --bounds=x,y,w,h
const {app, BrowserWindow} = require('electron');
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
app.whenReady().then(() => {
  const [x, y, width, height] = arg('bounds').split(',').map(Number);
  const win = new BrowserWindow({x, y, width, height, frame: false, transparent: true, hasShadow: false, resizable: false, backgroundColor: '#00000000', webPreferences: {backgroundThrottling: false}});
  win.loadURL(arg('url'));
});
