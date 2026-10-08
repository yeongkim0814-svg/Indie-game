// Entry: `?proto` opens the two-camera prototype, anything else is the game exactly as before.
if (/[?&]proto(=|&|$)/.test(location.search)) void import("./proto/main");
else void import("./play");
