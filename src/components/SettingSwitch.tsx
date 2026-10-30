type Props={label:string;checked:boolean;disabled?:boolean;onChange:(value:boolean)=>void};
export default function SettingSwitch({label,checked,disabled=false,onChange}:Props){
 return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={()=>onChange(!checked)}
  className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wh-accent-text)] disabled:opacity-50">
  <span className={`relative inline-block h-6 w-11 rounded-full transition-colors duration-150 motion-reduce:transition-none ${checked?'bg-violet-600':'bg-[var(--wh-switch-off)]'}`}>
   <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none ${checked?'translate-x-5':''}`}/>
  </span>
 </button>;
}
