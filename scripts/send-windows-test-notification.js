const { app, Notification } = require('electron');

app.setAppUserModelId('com.agentisland.capturetest');
app.whenReady().then(() => {
  const notification = new Notification({
  title: 'Windows notification capture test',
  body: 'If the integration is active, this notification will appear in Agent Island.',
    silent: true
  });
  notification.show();
  setTimeout(() => app.quit(), 2200);
});
