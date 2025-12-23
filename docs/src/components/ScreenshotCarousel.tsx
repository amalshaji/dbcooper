import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";

const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 1,
    slidesToScroll: 1,
    autoplay: true,
    autoplaySpeed: 4000,
    arrows: false,
};

export function ScreenshotCarousel() {
    return (
        <Slider {...settings}>
            <div>
                <img
                    src="/images/dbcooper.png"
                    alt="DBcooper interface"
                    className="w-full rounded-lg"
                />
            </div>
            <div>
                <img
                    src="/images/aggregate.png"
                    alt="Complex query"
                    className="w-full rounded-lg"
                />
            </div>
        </Slider>
    );
}
