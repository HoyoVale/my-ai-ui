import { HashRouter, Routes, Route } from "react-router-dom";
import Response from "./Response/Response.jsx";
import Input from "./Input/Input.jsx";
import Pet from "./Pet/Pet.jsx";
import Setting from "./Setting/Setting.jsx"

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/input" element={<Input />} />
        <Route path="/response" element={<Response />} />
        <Route path="/" element={<Pet />} />
        <Route path="/setting" element={<Setting />} />
      </Routes>
    </HashRouter>
  );
}

export default App;