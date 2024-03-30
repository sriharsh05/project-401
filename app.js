const express = require("express");
const app = express();
const bodyParser = require("body-parser");
var cookieParser = require("cookie-parser");
var csrf = require("tiny-csrf");
const path = require("path");
const passport = require("passport");
const connectEnsureLogin = require("connect-ensure-login");
const session = require("express-session");
const flash = require("connect-flash");

const LocalStrategy = require("passport-local");
const bcrypt = require("bcrypt");
const dotenv = require("dotenv");

const saltRounds = 10;

app.use(bodyParser.json());
dotenv.config();

// Set EJS as view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser("shh! some secret string"));
// app.use(csrf({ cookie: true }))
app.use(express.static(path.join(__dirname, "public")));
app.use(flash());
app.use(
  session({
    secret: "my-super-secret-key-21728172615261562",
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, //24hrs
    },
  })
);
app.use(csrf("this_should_be_32_character_long", ["POST", "PUT", "DELETE"]));

app.use(function (request, response, next) {
  response.locals.messages = request.flash();
  next();
});

app.use(passport.initialize());
app.use(passport.session());

passport.use(
  new LocalStrategy(
    {
      usernameField: "email",
      passwordField: "password",
    },
    (username, password, done) => {
      User.findOne({ where: { email: username } })
        .then(async (user) => {
          if (!user) {
            return done(null, false, { message: "Invalid login credentials" });
          }
          const result = await bcrypt.compare(password, user.password);
          if (result) {
            return done(null, user);
          } else {
            return done(null, false, { message: "Invalid login credentials" });
          }
        })
        .catch((error) => {
          return done(error);
        });
    }
  )
);

passport.serializeUser((user, done) => {
  // console.log("Serializing user in session", user.id);
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  User.findByPk(id)
    .then((user) => {
      done(null, user);
    })
    .catch((error) => {
      done(error, null);
    });
});

// Initialize openai api key

const OpenAI = require("openai");

openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const systemPrompt = 
   "You are an assistant helping a user manage their to-do list. " +
   "Given a message, you should extract the to-do item from it." +
   "The uset may provide a due date along with to-do item. " +
   "To compute relative dates, assume that the current timestamp is " +
   new Date().toISOString() + 
   ". When the input is ambiguous, ask for clarification." ; 

async function askGPT(question) {
  try{
  const chatCompletion = await openai.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question }
    ], 
    model: "gpt-3.5-turbo",
    tools: [
      {
        type: "function",
        function:{
           name: "createTodo",
           description: "Create a todo item",
           parameters: {
            type: "object",
            properties:{
              text: {
                type: "string",
                description: "Text of the todo item"
              },
              dueAt: {
                type: "string",
                description: "The time the to-do item is due as ISO8601"
              },  
              }
            }
           }
        }
    ],
    tool_choice: { type:"function", function: {name: "createTodo"}},
  });  
  console.log("Chat completion", chatCompletion.choices[0].message.tool_calls[0].function);
  return chatCompletion.choices[0].message.tool_calls[0].function;
} catch (error) {
  console.error("Error making a query", error);
  return null;
 }
}

const { Todo, User } = require("./models");

async function addTodoWithChatGPT(question){
  const toolCall = await askGPT(question);
  console.log("Tool call", toolCall);

  switch(toolCall.name){
    case "createTodo":
     const arguments = JSON.parse(toolCall.arguments);

      try {
        connectEnsureLogin.ensureLoggedIn();
        await Todo.addTodo({
          title: arguments.text,
          dueDate: arguments.dueAt,
          userId: request.user.id,
        });
        redirect("/")
        console.log("Adding todo", arguments.text, arguments.dueAt);
      }catch (error){
        console.log(error.message);
      }
     break;
    default:
      console.log("Unknown tool call", toolCall.name);
  }
}


app.get(
  "/",
  connectEnsureLogin.ensureLoggedOut({
    redirectTo: "/todos",
  }),
  async (request, response) => {
    response.render("index", {
      title: "Todo application",
      csrfToken: request.csrfToken(),
    });
  }
);

app.get(
  "/todos",
  connectEnsureLogin.ensureLoggedIn(),
  async (request, response) => {
    const loggedInUser = request.user.id;
    const overdue = await Todo.overdue(loggedInUser);
    const dueToday = await Todo.dueToday(loggedInUser);
    const dueLater = await Todo.dueLater(loggedInUser);
    const completed = await Todo.completed(loggedInUser);
    if (request.accepts("html")) {
      response.render("todos", {
        title: "Todo application",
        overdue,
        dueToday,
        dueLater,
        completed,
        csrfToken: request.csrfToken(),
      });
    } else {
      response.json({
        overdue,
        dueToday,
        dueLater,
        completed,
      });
    }
  }
);

app.get("/signup", (request, response) => {
  response.render("signup", {
    title: "Signup",
    csrfToken: request.csrfToken(),
  });
});

app.post("/users", async (request, response) => {
  // Hash password using bcrypt
  const password = request.body.password.trim();
  if (password.length < 8) {
    request.flash("error", "Password should be minimum 8 characters");
    return response.redirect("/signup");
  }
  const hashedPwd = await bcrypt.hash(password, saltRounds);
  // console.log(hashedPwd);
  // Have to create the user here
  try {
    const user = await User.create({
      firstName: request.body.firstName,
      lastName: request.body.lastName,
      email: request.body.email,
      password: hashedPwd,
    });
    request.login(user, (err) => {
      if (err) {
        console.log(err);
      }
      response.redirect("/todos");
    });
  } catch (error) {
    console.log(error);
    error.errors &&
      error.errors.length &&
      error.errors.map((anError) => request.flash("error", anError.message));

    response.redirect("/signup");
  }
});

app.get("/login", (request, response) => {
  response.render("login", { title: "Login", csrfToken: request.csrfToken() });
});

app.post(
  "/session",
  passport.authenticate("local", {
    failureRedirect: "/login",
    failureFlash: true,
  }),
  (request, response) => {
    response.redirect("/todos");
  }
);

app.get("/signout", (request, response, next) => {
  // Signout
  request.logout((err) => {
    if (err) {
      return next(err);
    }
    response.redirect("/");
  });
});

app.post(
  "/todos",
  connectEnsureLogin.ensureLoggedIn(),
  async (request, response) => {
    try {
      await Todo.addTodo({
        title: request.body.title,
        dueDate: request.body.dueDate,
        userId: request.user.id,
      });
      return response.redirect("/todos");
    } catch (error) {
      console.log(error.message);
      request.flash("error", error.message);
      return response.redirect("/todos");
    }
  }
);

// PUT http://mytodoapp.com/todos/123/
app.put(
  "/todos/:id",
  connectEnsureLogin.ensureLoggedIn(),
  async (request, response) => {
    // console.log("We have to update a todo with ID:", request.params.id);
    const todo = await Todo.findByPk(request.params.id);
    if (todo.userId !== request.user.id) {
      return response.status(401).json({ error: "No such item" });
    }
    try {
      const updatedTodo = await todo.setCompletionStatus(
        request.body.completed
      );
      return response.json(updatedTodo);
    } catch (error) {
      console.log(error);
      return response.status(422).json(error);
    }
  }
);

// eslint-disable-next-line no-unused-vars
app.delete(
  "/todos/:id",
  connectEnsureLogin.ensureLoggedIn(),
  async (request, response) => {
    try {
      const deletedRows = await Todo.remove(request.params.id, request.user.id);
      return response.json({ success: deletedRows > 0 });
    } catch (error) {
      return response.status(422).json(error);
    }
  }
);

app.post(
  "/add-natural",
  connectEnsureLogin.ensureLoggedIn(),
  async (request, response) => {
    await addTodoWithChatGPT(request.body.naturalText);
    response.redirect("/");
  }
)

module.exports = app;
