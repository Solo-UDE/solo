import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/inter";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

// Dev-only UI gallery: launch with `?__gallery=1` appended to the URL.
// The gallery renders every @solo/ui primitive for visual regression checks.
if (new URLSearchParams(location.search).has("__gallery")) {
  import("./dev/UIGallery").then(({ UIGallery }) => {
    root.render(
      <React.StrictMode>
        <UIGallery />
      </React.StrictMode>,
    );
  });
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
