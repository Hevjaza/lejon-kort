from PIL import Image,ImageDraw,ImageFont,ImageFilter
def icon(S,path):
    im=Image.new('RGB',(S,S),'#0b0f18'); d=ImageDraw.Draw(im)
    for y in range(S):  # subtle vertical gradient
        c=int(18+ (y/S)*10); d.line([(0,y),(S,y)],fill=(c-6,c-2,c+12))
    s=S/512
    # back card (tilted) emerald
    back=Image.new('RGBA',(S,S),(0,0,0,0)); bd=ImageDraw.Draw(back)
    bd.rounded_rectangle([190*s,92*s,370*s,342*s],radius=22*s,fill=(20,60,48,255),outline=(60,207,142,255),width=int(9*s))
    back=back.rotate(-14,center=(280*s,217*s),resample=Image.BICUBIC)
    im.paste(back,(0,0),back)
    front=Image.new('RGBA',(S,S),(0,0,0,0)); fd=ImageDraw.Draw(front)
    fd.rounded_rectangle([132*s,104*s,322*s,366*s],radius=24*s,fill=(26,32,46,255),outline=(255,196,0,255),width=int(11*s))
    f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',int(150*s))
    fd.text((227*s,238*s),'L',font=f,fill=(255,196,0,255),anchor='mm')
    front=front.rotate(6,center=(227*s,235*s),resample=Image.BICUBIC)
    im.paste(front,(0,0),front)
    # sparkle
    d=ImageDraw.Draw(im); cx,cy,r=372*s,118*s,34*s
    d.polygon([(cx,cy-r),(cx+r*.28,cy-r*.28),(cx+r,cy),(cx+r*.28,cy+r*.28),(cx,cy+r),(cx-r*.28,cy+r*.28),(cx-r,cy),(cx-r*.28,cy-r*.28)],fill='white')
    f2=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',int(54*s))
    d.text((256*s,438*s),'KORT',font=f2,fill='white',anchor='mm')
    im.save(path)
icon(512,'icon-512.png'); icon(192,'icon-192.png'); icon(180,'apple-touch-icon.png')
