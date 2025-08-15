import express from "express";
import path from "path";
import mongoose from "mongoose";
import methodOverride from "method-override";
import Business from "./models/business.js";
import Review from "./models/review.js";
import { fileURLToPath } from 'url';
import session from 'express-session';
import OpenAI from "openai";
import dotenv from 'dotenv';

// .env 파일을 가장 먼저 읽어오도록 설정합니다.
dotenv.config();

// OpenAI 클라이언트를 .env 파일의 비밀번호를 이용해 설정합니다. (안전한 방식)
const openAIClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    organization: process.env.ORGANIZATION_ID,
});

const url = 'mongodb+srv://kusoyoung0326:tuZN1Uc3TeRqMFhj@cluster0.h6pbeh7.mongodb.net/yelpclone?retryWrites=true&w=majority&appName=Cluster0'
mongoose.connect(url, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => {
    console.log("Database connected");
});

const app = express();

app.set("view engine", "ejs");

const __filename = fileURLToPath(import.meta.url); 
const __dirname = path.dirname(__filename); 
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.json());
app.use(express.json()); // JSON 요청 본문을 파싱하기 위해 추가
app.use(session({ secret: "thisisnotagoodsecret", resave: false, saveUninitialized: true })); // 세션 관리를 위해 추가


app.get('/', (req, res) => {
    res.render('home')
});

app.get('/business', async(req, res) => {
    const business = await Business.find({});
    res.render('businesses/index', { business });
});

app.get('/business/new', (req, res) => {
    res.render('businesses/new');
});

app.post('/business', async (req, res) => {
    const newBusiness = new Business(req.body.business); 
    await newBusiness.save();
    res.redirect(`/business/${newBusiness._id}`);
});

app.get('/business/:id/update', async (req, res) => {
    const { id } = req.params;
    const business = await Business.findById(id);
    res.render('businesses/update', { business });
});
app.put('/business/:id', async (req, res) => {
    const { id } = req.params;
    const business = await Business.findByIdAndUpdate(id, { ...req.body.business }, { runValidators: true, new: true });
    res.redirect(`/business/${business._id}`);
});

app.delete('/business/:id', async (req, res) => {
    const { id } = req.params;
    await Business.findByIdAndDelete(id);
    res.redirect('/business');
});

// [POST] 새로운 리뷰를 생성하고 저장하는 라우트 (버그 수정 및 최적화)
app.post('/business/:id/reviews', async (req, res) => {
    const business = await Business.findById(req.params.id);
    const review = new Review(req.body.review);
    business.reviews.push(review);
    await review.save();
    await business.save(); // <-- 이 한 줄이 빠져서 발생했던 버그였습니다!

    // 평점 재계산 로직은 리뷰 저장 후에 다시 실행합니다.
    const updatedBusiness = await Business.findById(req.params.id).populate('reviews');
    const totalRating = updatedBusiness.reviews.reduce((sum, rev) => sum + rev.rating, 0);
    updatedBusiness.averageRating = (updatedBusiness.reviews.length > 0) ? (totalRating / updatedBusiness.reviews.length).toFixed(2) : 0;
    await updatedBusiness.save();

    res.redirect(`/business/${business._id}`);
});

// [DELETE] 특정 리뷰를 삭제하는 라우트 (평균 평점 계산 추가됨)
app.delete('/business/:id/reviews/:reviewId', async (req, res) => {
    const { id, reviewId } = req.params;
    await Business.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });
    await Review.findByIdAndDelete(reviewId);

    const updatedBusiness = await Business.findById(id).populate('reviews');
    const totalRating = updatedBusiness.reviews.reduce((sum, review) => sum + review.rating, 0);
    updatedBusiness.averageRating = (updatedBusiness.reviews.length > 0) ? (totalRating / updatedBusiness.reviews.length).toFixed(2) : 0;
    await updatedBusiness.save();

    res.redirect(`/business/${id}`);
});

// 상세 페이지 라우트 (populate가 추가된 최종 버전)
app.get('/business/:id', async (req, res) => {
    const business = await Business.findById(req.params.id).populate('reviews');
    res.render('businesses/show', { business });
});
// [POST] 챗봇 요청을 처리하는 API 라우트
app.post('/chat', async (req, res) => {
    // 1. 세션에 대화 기록이 없으면 새로 만들어줍니다.
    if (!req.session.messages) {
        req.session.messages = [];
    }

    try {
        // 2. 프론트엔드에서 보낸 데이터(사용자 메시지, 가게 정보)를 가져옵니다.
        const userPrompt = req.body.prompt;
        const businessContext = req.body.context; // 가게 정보

        // 3. OpenAI에게 보낼 시스템 메시지(사전 정보)를 만듭니다.
        const systemMessage = `You are a helpful assistant for a business directory. The user is currently viewing the page for the following business: ${businessContext}. Answer their questions based on this context.`;
        
        // 4. 기존 대화 기록에 시스템 메시지와 새로운 사용자 메시지를 추가합니다.
        const messagesToSend = [
            { role: "system", content: systemMessage },
            ...req.session.messages, // 이전 대화 기록
            { role: "user", content: userPrompt }
        ];

        // 5. OpenAI API에 요청을 보냅니다.
        const completion = await openAIClient.chat.completions.create({
            messages: messagesToSend,
            model: "gpt-3.5-turbo", // gpt-4.1 모델명은 예시이며, 실제 사용 가능한 모델(gpt-3.5-turbo 등)로 변경했습니다.
        });

        // 6. OpenAI의 답변을 가져옵니다.
        const botResponse = completion.choices[0].message.content;

        // 7. 다음 대화를 위해 현재 대화(사용자 질문 + AI 답변)를 세션에 저장합니다.
        req.session.messages.push({ role: "user", content: userPrompt });
        req.session.messages.push({ role: "assistant", content: botResponse });

        // 8. 프론트엔드에 AI의 답변을 JSON 형태로 응답합니다.
        res.json({ response: botResponse });

    } catch (error) {
        console.error("Error with OpenAI API:", error);
        res.status(500).json({ error: "Something went wrong with the chatbot." });
    }
});


app.listen(3000, () => {
    console.log('Serving on port 3000')
});
