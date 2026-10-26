import {createRoot} from 'react-dom/client';
import {useDiscoveryLocation} from '../../src/hooks/useDiscoveryLocation';
import '../../src/index.css';
function Fixture(){
 const {location,locating,error,requestLocation,clearLocation}=useDiscoveryLocation();
 return <main><button onClick={requestLocation}>Use my location</button><button onClick={clearLocation}>Clear location</button><output aria-label="Location">{location?JSON.stringify(location):'none'}</output><output aria-label="Locating">{String(locating)}</output><p>{error}</p></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
