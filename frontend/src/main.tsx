import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { WorkspaceProvider } from './store';
import './styles/tokens.css';
import './styles/lucian.css';
import './styles/app.css';
import './styles/theme.css';
import './styles/bento-workspace.css';
import './styles/interface-additions.css';
import './styles/simple-ui.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <WorkspaceProvider><App /></WorkspaceProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
