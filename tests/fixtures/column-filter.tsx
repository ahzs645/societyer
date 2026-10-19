import React, {useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {ViewportPopover} from "../../src/components/ViewportPopover";
import {Select} from "../../src/components/Select";
import "../../src/theme/palette.css";
import "../../src/theme/tokens.css";
import "../../src/styles/index.scss";
function Fixture() {
 const anchor=useRef<HTMLButtonElement>(null), [open,setOpen]=useState(false), [operator,setOperator]=useState("eq");
 return <main style={{padding:40}}><button ref={anchor} onClick={()=>setOpen(true)}>Documents column</button>
 <ViewportPopover open={open} onClose={()=>setOpen(false)} anchorRef={anchor} label="Documents column" className="record-table__header-menu">
 <button>Sort ascending</button><button>Sort descending</button>
 <div className="record-table__header-menu-section"><div className="record-table__header-filter"><span>Filter</span>
 <Select aria-label="Documents filter condition" value={operator} onChange={setOperator} options={[{value:"eq",label:"Equals"},{value:"gte",label:"At least"},{value:"gt",label:"Greater than"},{value:"isEmpty",label:"Has no value"}]} />
 {operator!=="isEmpty" && <input aria-label="Documents filter value" />}</div><button>Apply filter</button></div>
 <button>Move left</button><button>Hide field</button></ViewportPopover></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
