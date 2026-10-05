import {useState} from "react";
import {useToast} from "../../../components/Toast";

type OriginalDownload = {fileName:string;mimeType:string;sha256:string;parts:Array<{url:string;bytes:number;sha256:string}>};
const digest = async (bytes:ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");

/** Exact source files preserve the layout, vector artwork and watermarks. */
export function SourceOriginalDownload({source}:{source:{title:string;originalDownload?:OriginalDownload}}) {
  const [busy,setBusy]=useState(false);
  const toast=useToast();
  const original=source.originalDownload;
  if (!original) return null;
  const download=async()=>{
    setBusy(true);
    try {
      const chunks:ArrayBuffer[]=[];
      for (const part of original.parts) {
        if (!part.url.startsWith("/test-data/source-record-v3/originals/") || part.url.includes("..")) throw new Error("The source download reference is invalid.");
        const response=await fetch(part.url,{credentials:"same-origin"});
        if (!response.ok) throw new Error("The original source could not be downloaded.");
        const bytes=await response.arrayBuffer();
        if (bytes.byteLength!==part.bytes || await digest(bytes)!==part.sha256) throw new Error("The source download was incomplete. Please try again.");
        chunks.push(bytes);
      }
      const blob=new Blob(chunks,{type:original.mimeType});
      if (await digest(await blob.arrayBuffer())!==original.sha256) throw new Error("The source download was incomplete. Please try again.");
      const url=URL.createObjectURL(blob);const anchor=document.createElement("a");
      anchor.href=url;anchor.download=original.fileName;anchor.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),10000);
    } catch(error:any) {toast.error("Source download failed",error?.message);}
    finally {setBusy(false);}
  };
  return <div className="row" style={{gap:12,justifyContent:"space-between",flexWrap:"wrap"}}><span>{source.title}</span><button className="btn" type="button" onClick={()=>void download()} disabled={busy}>{busy?"Downloading…":"Download original source"}</button></div>;
}
