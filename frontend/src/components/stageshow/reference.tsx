import ReactDOM from 'react-dom/client';
import GoldReference from './GoldReference';
import { ProductionStory } from './ProductionStory';
import { WorkspaceProvider } from '../../store';

const production = new URLSearchParams(location.search).has('production');
const dark = new URLSearchParams(location.search).has('dark');
document.body.style.margin = '0';
document.body.style.padding = '40px';
document.body.style.background = dark ? '#11151c' : '#f5f6f8';
ReactDOM.createRoot(document.getElementById('root')!).render(<WorkspaceProvider><div id="example" style={{width:400}}>{production ? <ProductionStory previewTheme={dark ? 'dark' : 'light'} /> : <GoldReference />}</div></WorkspaceProvider>);
