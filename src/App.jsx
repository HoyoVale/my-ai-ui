import {
  lazy,
  Suspense
} from "react";

import {
  HashRouter,
  Route,
  Routes
} from "react-router-dom";

const Conversation = lazy(() => import("./Conversation/Conversation.jsx"));
const Input = lazy(() => import("./Input/Input.jsx"));
const Memory = lazy(() => import("./Memory/Memory.jsx"));
const Pet = lazy(() => import("./Pet/Pet.jsx"));
const Response = lazy(() => import("./Response/Response.jsx"));
const Setting = lazy(() => import("./Setting/Setting.jsx"));

function App() {
  return (
    <HashRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Pet />} />
          <Route path="/input" element={<Input />} />
          <Route path="/response" element={<Response />} />
          <Route path="/setting" element={<Setting />} />
          <Route path="/conversation" element={<Conversation />} />
          <Route path="/memory" element={<Memory />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}

export default App;
