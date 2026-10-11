import React from 'react';
import { createRoot } from 'react-dom/client';
import { BackendApp } from './BackendApp.jsx';
import { LocaleProvider, LanguageSwitch } from './farm-support/LocaleProvider.jsx';
import './backend-base.css';
import './farm-support/styles.css';

createRoot(document.getElementById('root')).render(<LocaleProvider><div className="fs-global-language"><LanguageSwitch /></div><BackendApp /></LocaleProvider>);
