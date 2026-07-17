import {
  HashRouter,
  Route,
  Routes
} from "react-router-dom";

import Conversation
  from "./Conversation/Conversation.jsx";
import Input
  from "./Input/Input.jsx";
import Memory
  from "./Memory/Memory.jsx";
import Pet
  from "./Pet/Pet.jsx";
import Response
  from "./Response/Response.jsx";
import Setting
  from "./Setting/Setting.jsx";

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route
          path="/"
          element={<Pet />}
        />

        <Route
          path="/input"
          element={<Input />}
        />

        <Route
          path="/response"
          element={<Response />}
        />

        <Route
          path="/setting"
          element={<Setting />}
        />

        <Route
          path="/conversation"
          element={<Conversation />}
        />

        <Route
          path="/memory"
          element={<Memory />}
        />
      </Routes>
    </HashRouter>
  );
}

export default App;
