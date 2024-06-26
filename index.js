const app = require("./app");
const dotenv = require("dotenv");

dotenv.config();

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Started express server at port ${port}`);
});
