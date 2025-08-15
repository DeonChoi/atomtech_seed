import mongoose from 'mongoose';
const Schema = mongoose.Schema;

const BusinessSchema = new Schema({
    title: String,
    location: String,
    description: String,
    reviews: [
        {
            type: Schema.Types.ObjectId,
            ref: 'Review'
        }
    ],

    averageRating: {
        type: Number,
        default: 0
    }
});

export default mongoose.model('Business', BusinessSchema);