import DualRangeSlider from './DualRangeSlider';

export default function RoommateBudgetField({minimum,maximum,onChange}:{minimum:number;maximum:number;onChange:(minimum:number,maximum:number)=>void}){return <div><p className="mb-2 text-[9px] font-semibold uppercase tracking-wide text-[#74798A]">Housing budget</p><DualRangeSlider min={minimum} max={maximum} floor={180000} ceiling={5000000} step={10000} onChange={onChange}/></div>}
