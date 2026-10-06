import {useState} from "react";
import {loadSourceOriginal} from "../../../lib/workspaceArchiveFiles";
import {useToast} from "../../../components/Toast";

type OriginalDownload = {fileName:string;mimeType:string;sha256:string;parts:Array<{url:string;bytes:number;sha256:string}>};

/** Exact source files preserve the layout, vector artwork and watermarks. */
export function SourceOriginalDownload({source}:{source:{title:string;originalDownload?:OriginalDownload}}) {
  const [busy,setBusy]=useState(false);
  const toast=useToast();
  const original=source.originalDownload;
  if (!original) return null;
  const download=async()=>{
    setBusy(true);
    try {
      const blob=await loadSourceOriginal(original);
      const url=URL.createObjectURL(blob);const anchor=document.createElement("a");
      anchor.href=url;anchor.download=original.fileName;anchor.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),10000);
    } catch(error:any) {toast.error("Source download failed",error?.message);}
    finally {setBusy(false);}
  };
  return <div className="row" style={{gap:12,justifyContent:"space-between",flexWrap:"wrap"}}><span>{source.title}</span><button className="btn" type="button" onClick={()=>void download()} disabled={busy}>{busy?"Downloading…":"Download original source"}</button></div>;
}
